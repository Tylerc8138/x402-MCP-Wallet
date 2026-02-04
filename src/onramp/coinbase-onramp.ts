/**
 * Coinbase Onramp Integration with Secure Backend
 * 
 * Architecture: Frontend → Secure Backend → Coinbase Onramp (App ID)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

export interface OnrampConfig {
  backendUrl: string;
  apiKey: string;
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
 * Request onramp URL from secure backend
 */
async function requestOnrampUrl(
  params: FundWalletParams,
  config: OnrampConfig
): Promise<{ onrampUrl: string; sessionId: string }> {
  const { walletAddress, amountUSD, asset = 'USDC', network = 'base' } = params;
  
  console.log(`🔐 Requesting secure onramp URL from backend...`);
  
  const response = await fetch(`${config.backendUrl}/api/onramp/create-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey
    },
    body: JSON.stringify({
      wallet_address: walletAddress,
      amount_usd: amountUSD,
      asset,
      network
    })
  });
  
  if (!response.ok) {
    const errorData: any = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Backend error: ${response.status}`);
  }
  
  const data: any = await response.json();
  
  if (!data.success || !data.onrampUrl) {
    throw new Error('Failed to obtain onramp URL');
  }
  
  console.log(`✅ Secure URL obtained (Session: ${data.sessionId})`);
  return { onrampUrl: data.onrampUrl, sessionId: data.sessionId };
}

/**
 * Fund wallet via Coinbase Onramp with secure backend
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

  // Request secure URL from backend
  let onrampUrl: string;
  let sessionId: string;
  
  try {
    const result = await requestOnrampUrl(params, config);
    onrampUrl = result.onrampUrl;
    sessionId = result.sessionId;
  } catch (error) {
    throw new Error(`Failed to create secure funding session: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

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
 * Create Coinbase Onramp config
 */
export function createOnrampConfig(): OnrampConfig {
  const backendUrl = process.env.CLAWD_BACKEND_URL || 'http://localhost:8402';
  const apiKey = process.env.CLAWD_BACKEND_API_KEY;
  
  if (!apiKey) {
    throw new Error('CLAWD_BACKEND_API_KEY environment variable is required');
  }
  
  return {
    backendUrl,
    apiKey
  };
}