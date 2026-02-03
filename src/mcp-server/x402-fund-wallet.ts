/**
 * x402 Fund Wallet Tool
 * MCP tool for adding USD to Base wallet via Coinbase Onramp
 */

import { z } from 'zod';
import { fundWalletViaCoinbase, createOnrampConfig } from '../onramp/coinbase-onramp.js';

// Tool input schema
export const FundWalletInputSchema = z.object({
  amount_usd: z
    .number()
    .min(1, 'Minimum funding amount is $1')
    .max(10000, 'Maximum funding amount is $10,000')
    .describe('Amount in USD to add to wallet (1-10000)'),
  asset: z
    .enum(['USDC', 'ETH', 'USDT'])
    .default('USDC')
    .describe('Asset to purchase (defaults to USDC)'),
  network: z
    .enum(['base', 'ethereum', 'polygon'])
    .default('base')
    .describe('Blockchain network (defaults to Base)')
});

export type FundWalletInput = z.infer<typeof FundWalletInputSchema>;

/**
 * Execute the fund wallet operation
 */
export async function executeFundWallet(
  input: FundWalletInput,
  getWalletAddress: () => Promise<string>
): Promise<string> {
  const { amount_usd, asset, network } = input;

  try {
    // Get user's wallet address
    const walletAddress = await getWalletAddress();

    if (!walletAddress) {
      throw new Error('No wallet found. Wallet will be created on first use.');
    }

    // Create onramp config
    const config = createOnrampConfig();

    // Execute funding via Coinbase
    const result = await fundWalletViaCoinbase(
      {
        walletAddress,
        amountUSD: amount_usd,
        asset,
        network
      },
      config
    );

    // Format response
    const response = {
      success: true,
      operation: 'fund_wallet',
      details: {
        wallet_address: result.walletAddress,
        amount: `$${result.expectedAmount} USD`,
        asset: result.currency,
        network: network,
        onramp_url: result.onrampUrl,
        estimated_arrival: result.estimatedArrival
      },
      instructions: [
        '1. Complete payment in the browser window that just opened',
        '2. Wait 1-5 minutes for funds to arrive',
        '3. Use x402_check_balance to verify funds received',
        '',
        'Note: First-time Coinbase users may need to complete identity verification.'
      ].join('\n'),
      next_steps: {
        check_balance: 'Use x402_check_balance tool',
        view_transaction: `https://basescan.org/address/${result.walletAddress}`
      }
    };

    return JSON.stringify(response, null, 2);

  } catch (error: any) {
    const errorResponse = {
      success: false,
      error: error.message || 'Failed to initiate wallet funding',
      troubleshooting: [
        '- Ensure your wallet is initialized (will auto-create on first use)',
        '- Check that amount is between $1-$10,000',
        '- Verify internet connection',
        '- Try manually opening the Coinbase Onramp: https://pay.coinbase.com'
      ]
    };

    return JSON.stringify(errorResponse, null, 2);
  }
}

/**
 * Tool metadata for MCP registration
 */
export const FundWalletToolMetadata = {
  name: 'x402_fund_wallet',
  description: 'Add USD to your Base wallet using debit/credit card via Coinbase Onramp. Opens a secure browser window for payment. Supports amounts from $1 to $10,000. Funds typically arrive in 1-5 minutes.',
  inputSchema: FundWalletInputSchema
};