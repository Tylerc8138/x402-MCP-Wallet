"""Coinbase Onramp integration for wallet funding."""
import secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode
import json

from . import config

# In-memory storage for rate limiting (use Redis in production)
rate_limit_store = {}
session_logs = []


class OnrampRateLimiter:
    """Simple in-memory rate limiter for onramp requests."""
    
    @staticmethod
    def check_rate_limit(ip_address: str) -> tuple[bool, Optional[str]]:
        """
        Check if IP has exceeded rate limits.
        Returns (allowed: bool, error_message: Optional[str])
        """
        now = datetime.utcnow()
        hour_ago = now - timedelta(hours=1)
        day_ago = now - timedelta(days=1)
        
        # Get or create record
        if ip_address not in rate_limit_store:
            rate_limit_store[ip_address] = {
                "requests": [],
                "daily_amount": []
            }
        
        record = rate_limit_store[ip_address]
        
        # Clean old requests
        record["requests"] = [ts for ts in record["requests"] if ts > hour_ago]
        record["daily_amount"] = [(ts, amt) for ts, amt in record["daily_amount"] if ts > day_ago]
        
        # Check hourly limit
        if len(record["requests"]) >= config.ONRAMP_MAX_REQUESTS_PER_HOUR:
            minutes_left = int((record["requests"][0] - hour_ago).total_seconds() / 60)
            return False, f"Rate limit exceeded. Try again in {minutes_left} minutes."
        
        return True, None
    
    @staticmethod
    def check_amount_limit(ip_address: str, amount: float) -> tuple[bool, Optional[str]]:
        """Check if amount would exceed daily limit."""
        if ip_address not in rate_limit_store:
            return True, None
        
        record = rate_limit_store[ip_address]
        day_ago = datetime.utcnow() - timedelta(days=1)
        
        # Calculate today's total
        daily_total = sum(amt for ts, amt in record["daily_amount"] if ts > day_ago)
        
        if daily_total + amount > config.ONRAMP_MAX_AMOUNT_PER_DAY:
            return False, f"Daily limit of ${config.ONRAMP_MAX_AMOUNT_PER_DAY} would be exceeded"
        
        return True, None
    
    @staticmethod
    def record_request(ip_address: str, amount: float):
        """Record a successful request."""
        now = datetime.utcnow()
        
        if ip_address not in rate_limit_store:
            rate_limit_store[ip_address] = {
                "requests": [],
                "daily_amount": []
            }
        
        record = rate_limit_store[ip_address]
        record["requests"].append(now)
        record["daily_amount"].append((now, amount))


def generate_session_id() -> str:
    """Generate a unique session ID for tracking."""
    return secrets.token_hex(16)


def generate_coinbase_onramp_url(
    wallet_address: str,
    amount_usd: float,
    asset: str = "USDC",
    network: str = "base"
) -> str:
    """
    Generate Coinbase Onramp URL with App ID.
    
    Args:
        wallet_address: Destination wallet address
        amount_usd: Amount in USD
        asset: Crypto asset (USDC, ETH, USDT)
        network: Blockchain network (base, ethereum, polygon)
    
    Returns:
        Complete Coinbase Onramp URL
    """
    params = {
        "appId": config.COINBASE_ONRAMP_APP_ID,
        "addresses": json.dumps({network: [wallet_address]}),
        "assets": json.dumps([asset]),
        "defaultAsset": asset,
        "defaultNetwork": network,
        "presetFiatAmount": str(amount_usd)
    }
    
    return f"https://pay.coinbase.com/buy?{urlencode(params)}"


def log_onramp_session(
    session_id: str,
    wallet_address: str,
    amount_usd: float,
    asset: str,
    network: str,
    ip_address: str
):
    """Log onramp session for audit trail."""
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "session_id": session_id,
        "wallet_address": wallet_address,
        "amount_usd": amount_usd,
        "asset": asset,
        "network": network,
        "ip_address": ip_address
    }
    
    session_logs.append(log_entry)
    
    # Keep only last 1000 entries
    if len(session_logs) > 1000:
        session_logs.pop(0)


def validate_onramp_request(
    wallet_address: str,
    amount_usd: float,
    asset: str,
    network: str
) -> Optional[str]:
    """
    Validate onramp request parameters.
    Returns error message if invalid, None if valid.
    """
    # Validate wallet address
    if not wallet_address or not wallet_address.startswith("0x") or len(wallet_address) != 42:
        return "Invalid wallet address format"
    
    # Validate amount
    if amount_usd < 1:
        return "Amount must be at least $1"
    
    if amount_usd > config.ONRAMP_MAX_AMOUNT_PER_TX:
        return f"Amount cannot exceed ${config.ONRAMP_MAX_AMOUNT_PER_TX} per transaction"
    
    # Validate asset
    valid_assets = ["USDC", "ETH", "USDT"]
    if asset not in valid_assets:
        return f"Invalid asset. Must be one of: {', '.join(valid_assets)}"
    
    # Validate network
    valid_networks = ["base", "ethereum", "polygon"]
    if network not in valid_networks:
        return f"Invalid network. Must be one of: {', '.join(valid_networks)}"
    
    return None