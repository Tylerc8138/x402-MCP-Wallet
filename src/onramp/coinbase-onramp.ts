/**
 * Coinbase Onramp Integration
 *
 * Uses the Session Token approach with EC (ES256) key signing.
 * Based on: https://github.com/coinbase/onramp-demo-application
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { SignJWT, importPKCS8 } from 'jose';

const execAsync = promisify(exec);

export interface OnrampConfig {
  apiKeyName: string;
  privateKey: string;
}

export interface FundWalletParams {
  walletAddress: string;
  amountUSD: number;
  asset?: string;
  network?: string;
}

export interface FundWalletResult {
  success: boolean;
  walletAddress: string;
  expectedAmount: number;
  currency: string;
  onrampUrl: string;
  sessionId: string;
  message: string;
  estimatedArrival: string;
}

/**
 * Opens Coinbase Onramp in the user's default browser
 */
async function openBrowser(url: string): Promise<void> {
  const platform = os.platform();

  try {
    switch (platform) {
      case 'darwin':
        await execAsync(`open "${url}"`);
        break;
      case 'win32':
        await execAsync(`start "" "${url}"`);
        break;
      case 'linux':
        try {
          await execAsync(`xdg-open "${url}"`);
        } catch {
          await execAsync(`firefox "${url}" || google-chrome "${url}" || chromium "${url}"`);
        }
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  } catch (error) {
    console.error('Failed to open browser:', error);
    throw new Error(`Could not open browser. Please visit manually: ${url}`);
  }
}

/**
 * Generate a random nonce for JWT header
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Generate JWT for Coinbase API authentication using EC key (ES256)
 */
async function generateJWT(
  apiKeyName: string,
  privateKey: string,
  requestMethod: string,
  requestHost: string,
  requestPath: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 120;

  // Import the EC private key
  const ecKey = await importPKCS8(privateKey, 'ES256');

  // Create JWT claims
  const claims = {
    sub: apiKeyName,
    iss: 'cdp',
    uris: [`${requestMethod} ${requestHost}${requestPath}`],
  };

  // Sign and return the JWT
  return await new SignJWT(claims)
    .setProtectedHeader({
      alg: 'ES256',
      kid: apiKeyName,
      typ: 'JWT',
      nonce: generateNonce()
    })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + expiresIn)
    .sign(ecKey);
}

/**
 * Get session token from Coinbase Onramp API
 */
async function getSessionToken(
  config: OnrampConfig,
  walletAddress: string,
  network: string,
  assets: string[]
): Promise<string> {
  const host = 'api.developer.coinbase.com';
  const path = '/onramp/v1/token';
  const method = 'POST';

  console.log('Generating JWT with API key:', config.apiKeyName.substring(0, 50) + '...');

  // Generate JWT for authentication
  const jwt = await generateJWT(
    config.apiKeyName,
    config.privateKey,
    method,
    host,
    path
  );

  // Prepare request body
  const body = {
    addresses: [{
      address: walletAddress,
      blockchains: [network]
    }],
    assets: assets
  };

  console.log('Making request to CDP API...');

  // Make request to Coinbase API
  const response = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('CDP API error:', response.status, response.statusText);
    console.error('Response body:', responseText);
    throw new Error(`Coinbase API error (${response.status}): ${responseText}`);
  }

  // Parse successful response
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Invalid response from CDP API: ${responseText}`);
  }

  if (!data.token) {
    throw new Error('No token returned from Coinbase');
  }

  return data.token;
}

/**
 * Generate Coinbase Onramp URL with session token
 */
function generateOnrampUrl(
  sessionToken: string,
  amountUSD: number,
  asset: string,
  network: string
): string {
  const params = new URLSearchParams({
    sessionToken,
    defaultAsset: asset,
    defaultNetwork: network,
    presetFiatAmount: String(amountUSD)
  });

  return `https://pay.coinbase.com/buy/select-asset?${params.toString()}`;
}

/**
 * Fund wallet via Coinbase Onramp
 */
export async function fundWalletViaCoinbase(
  params: FundWalletParams,
  config: OnrampConfig
): Promise<FundWalletResult> {
  const { walletAddress, amountUSD, asset = 'USDC', network = 'base' } = params;

  // Validate amount
  if (amountUSD < 1 || amountUSD > 10000) {
    throw new Error('Amount must be between $1 and $10,000');
  }

  // Validate wallet address
  if (!walletAddress || !walletAddress.startsWith('0x')) {
    throw new Error('Invalid wallet address');
  }

  console.log(`🔐 Generating Coinbase session token...`);

  // Get session token
  let sessionToken: string;
  try {
    sessionToken = await getSessionToken(config, walletAddress, network, [asset]);
  } catch (error) {
    throw new Error(`Failed to get session token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Generate session ID for tracking
  const sessionId = Math.random().toString(36).substring(2, 15);

  // Generate onramp URL
  const onrampUrl = generateOnrampUrl(sessionToken, amountUSD, asset, network);

  console.log(`✅ Session token obtained`);

  // Open browser
  console.log(`\n🔗 Opening Coinbase Onramp...`);
  console.log(`💰 Amount: $${amountUSD} USD → ${asset}`);
  console.log(`🏦 Network: ${network}`);
  console.log(`📍 Wallet: ${walletAddress}`);
  console.log(`🔐 Session: ${sessionId}\n`);

  try {
    await openBrowser(onrampUrl);
  } catch (error) {
    console.warn('Could not open browser automatically. Use URL below:');
    console.log(onrampUrl);
  }

  return {
    success: true,
    walletAddress,
    expectedAmount: amountUSD,
    currency: asset,
    onrampUrl,
    sessionId,
    message: `Secure payment window opened. Complete purchase to add $${amountUSD} ${asset} to your wallet on ${network}.`,
    estimatedArrival: '1-5 minutes after payment confirmation'
  };
}

/**
 * Create Coinbase Onramp config from environment variables
 *
 * Required environment variables:
 * - CDP_API_KEY_NAME: Full API key name (organizations/{org_id}/apiKeys/{key_id})
 * - CDP_API_KEY_PRIVATE_KEY: EC private key in PEM format
 */
export function createOnrampConfig(): OnrampConfig {
  const apiKeyName = process.env.CDP_API_KEY_NAME;
  const privateKey = process.env.CDP_API_KEY_PRIVATE_KEY;

  if (!apiKeyName) {
    throw new Error(
      'CDP_API_KEY_NAME environment variable is required. ' +
      'Format: organizations/{org_id}/apiKeys/{key_id}'
    );
  }

  if (!privateKey) {
    throw new Error(
      'CDP_API_KEY_PRIVATE_KEY environment variable is required. ' +
      'This should be your EC private key in PEM format.'
    );
  }

  return { apiKeyName, privateKey };
}
