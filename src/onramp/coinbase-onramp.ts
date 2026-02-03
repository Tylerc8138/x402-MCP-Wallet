/**
 * Coinbase Onramp Integration
 * Provides fiat-to-crypto onramp functionality for funding Base wallets
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

export interface OnrampConfig {
  appId?: string; // Optional: Register at https://portal.cdp.coinbase.com/
  defaultNetwork: string;
  supportedAssets: string[];
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
      case 'darwin': // macOS
        await execAsync(`open "${url}"`);
        break;
      case 'win32': // Windows
        await execAsync(`start "" "${url}"`);
        break;
      case 'linux':
        // Try common Linux browsers
        try {
          await execAsync(`xdg-open "${url}"`);
        } catch {
          // Fallback to specific browsers
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
 * Generate Coinbase Onramp URL for funding wallet
 */
export function generateOnrampUrl(params: FundWalletParams, config: OnrampConfig): string {
  const {
    walletAddress,
    amountUSD,
    asset = 'USDC',
    network = 'base'
  } = params;

  // Build destination wallets parameter
  const destinationWallets = [{
    address: walletAddress,
    blockchains: [network],
    assets: [asset]
  }];

  // Build URL parameters
  const urlParams = new URLSearchParams({
    destinationWallets: JSON.stringify(destinationWallets),
    defaultAsset: asset,
    presetFiatAmount: amountUSD.toString(),
    defaultNetwork: network,
    defaultPaymentMethod: 'CARD' // Default to card payments
  });

  // Add app ID if provided
  if (config.appId) {
    urlParams.append('appId', config.appId);
  }

  return `https://pay.coinbase.com/buy/select-asset?${urlParams.toString()}`;
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

  // Generate onramp URL
  const onrampUrl = generateOnrampUrl(params, config);

  // Open browser
  console.log(`\n🔗 Opening Coinbase Onramp...`);
  console.log(`💰 Amount: $${amountUSD} USD → ${asset}`);
  console.log(`🏦 Network: ${network}`);
  console.log(`📍 Wallet: ${walletAddress}\n`);

  try {
    await openBrowser(onrampUrl);
  } catch (error) {
    // If browser fails to open, still return URL for manual access
    console.warn('Could not open browser automatically. Use URL below:');
    console.log(onrampUrl);
  }

  return {
    success: true,
    walletAddress,
    expectedAmount: amountUSD,
    currency: asset,
    onrampUrl,
    message: `Payment window opened in browser. Complete the purchase to add $${amountUSD} ${asset} to your wallet on ${network}.`,
    estimatedArrival: '1-5 minutes after payment confirmation'
  };
}

/**
 * Create default Coinbase Onramp config
 */
export function createOnrampConfig(): OnrampConfig {
  return {
    appId: process.env.COINBASE_ONRAMP_APP_ID, // Optional: Set in env vars
    defaultNetwork: 'base',
    supportedAssets: ['USDC', 'ETH', 'USDT']
  };
}