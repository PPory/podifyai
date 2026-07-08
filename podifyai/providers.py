import json
import os
import threading
import time
from dataclasses import dataclass
from hashlib import sha1
from typing import Any, Dict, List, Optional

import requests
from openai import OpenAI


def _normalize_api_base(base: str | None) -> str:
    base = (base or '').strip().rstrip('/')
    if not base:
        return ''
    if base.endswith('/v1'):
        return base
    return f"{base}/v1"


def _parse_accounts(env_name: str, key_env: str, base_env: str) -> List[dict]:
    raw = (os.getenv(env_name) or '').strip()
    accounts: List[dict] = []
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                accounts = [item for item in data if isinstance(item, dict) and item.get('key')]
        except json.JSONDecodeError as exc:
            raise ValueError(f'{env_name} 不是合法的 JSON: {exc}') from exc

    if accounts:
        return accounts

    key = (os.getenv(key_env) or '').strip()
    if not key:
        return []
    return [{
        'key': key,
        'base': os.getenv(base_env) or '',
        'weight': 1,
    }]


@dataclass
class _PoolAccount:
    key: str
    base: str
    weight: int = 1
    active: int = 0
    successes: int = 0
    failures: int = 0
    disabled: bool = False
    cooldown_until: float = 0.0


class KeyPool:
    def __init__(self, env_name: str, key_env: str, base_env: str):
        self.env_name = env_name
        self.key_env = key_env
        self.base_env = base_env
        self.max_retries = 2
        self.cooldown_seconds = 5
        self.default_max_conc = 3
        self.sticky_by = 'NONE'
        self.accounts: List[_PoolAccount] = []
        self._rr_index = 0
        self._lock = threading.RLock()
        self._cv = threading.Condition(self._lock)

    def reload_from_env(self) -> None:
        with self._cv:
            self.max_retries = int(os.getenv('KEYPOOL_MAX_RETRIES', str(self.max_retries)) or self.max_retries)
            self.cooldown_seconds = int(os.getenv('KEYPOOL_COOLDOWN_SECONDS', str(self.cooldown_seconds)) or self.cooldown_seconds)
            self.default_max_conc = int(os.getenv('KEYPOOL_MAX_CONCURRENCY_PER_KEY', str(self.default_max_conc)) or self.default_max_conc)
            self.sticky_by = (os.getenv('KEYPOOL_STICKY_BY', self.sticky_by) or 'NONE').upper()
            parsed = _parse_accounts(self.env_name, self.key_env, self.base_env)
            self.accounts = [
                _PoolAccount(
                    key=str(item.get('key', '')).strip(),
                    base=_normalize_api_base(item.get('base') or ''),
                    weight=int(item.get('weight', 1) or 1),
                )
                for item in parsed
                if str(item.get('key', '')).strip()
            ]
            self._rr_index = 0
            self._cv.notify_all()

    def _available_accounts(self) -> List[_PoolAccount]:
        now = time.time()
        return [
            account for account in self.accounts
            if not account.disabled
            and account.cooldown_until <= now
            and account.active < self.default_max_conc
        ]

    def acquire(self, user_ctx: Optional[dict] = None, wait_timeout: float = 10.0) -> _PoolAccount:
        deadline = time.time() + wait_timeout
        with self._cv:
            while True:
                available = self._available_accounts()
                if available:
                    chosen = self._choose_account(available, user_ctx)
                    chosen.active += 1
                    self._cv.notify_all()
                    return chosen

                remaining = deadline - time.time()
                if remaining <= 0:
                    raise RuntimeError(f'{self.env_name} 没有可用账号')

                waits = [
                    max(0.05, account.cooldown_until - time.time())
                    for account in self.accounts
                    if not account.disabled and account.cooldown_until > time.time()
                ]
                wait_for = min(waits) if waits else 0.1
                self._cv.wait(timeout=min(wait_for, remaining, 0.1))

    def _choose_account(self, available: List[_PoolAccount], user_ctx: Optional[dict]) -> _PoolAccount:
        if self.sticky_by == 'USER' and user_ctx and user_ctx.get('user_id') is not None:
            seed = sha1(str(user_ctx.get('user_id')).encode('utf-8')).hexdigest()
            start = int(seed[:8], 16) % len(available)
            return available[start]

        start = self._rr_index % len(available)
        chosen = available[start]
        self._rr_index = (self._rr_index + 1) % max(1, len(self.accounts))
        return chosen

    def release(self, account: Optional[_PoolAccount]) -> None:
        if account is None:
            return
        with self._cv:
            account.active = max(0, account.active - 1)
            self._cv.notify_all()

    def report_success(self, account: _PoolAccount) -> None:
        with self._cv:
            account.successes += 1
            self._cv.notify_all()

    def report_failure(self, account: _PoolAccount, status_code: int) -> None:
        with self._cv:
            account.failures += 1
            if status_code in (401, 403):
                account.disabled = True
            elif status_code == 429:
                account.cooldown_until = max(account.cooldown_until, time.time() + self.cooldown_seconds)
            self._cv.notify_all()

    def stats(self) -> Dict[str, int]:
        now = time.time()
        with self._lock:
            return {
                'total': len(self.accounts),
                'available': sum(1 for account in self.accounts if not account.disabled and account.cooldown_until <= now),
                'active': sum(account.active for account in self.accounts),
                'cooldown': sum(1 for account in self.accounts if not account.disabled and account.cooldown_until > now),
                'disabled': sum(1 for account in self.accounts if account.disabled),
                'successes': sum(account.successes for account in self.accounts),
                'failures': sum(account.failures for account in self.accounts),
            }


_sf_pool = KeyPool('SILICONFLOW_ACCOUNTS', 'SILICONFLOW_API_KEY', 'SILICONFLOW_API_BASE')
_gemini_pool = KeyPool('OPENAI_ACCOUNTS', 'OPENAI_API_KEY', 'OPENAI_API_BASE')


def reload_keypools_from_env() -> None:
    _sf_pool.reload_from_env()
    _gemini_pool.reload_from_env()


def pools_stats() -> Dict[str, Dict[str, int]]:
    return {
        'siliconflow': _sf_pool.stats(),
        'openai': _gemini_pool.stats(),
    }


def _auth_headers(account: _PoolAccount, extra_headers: Optional[dict] = None) -> dict:
    headers = {'Authorization': f'Bearer {account.key}'}
    if extra_headers:
        headers.update(extra_headers)
    return headers


def _build_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def sf_request(user_ctx: Optional[dict], method: str, path: str, timeout: float = 10, _route: str = '', **kwargs):
    del _route
    last_response = None
    last_error = None
    attempts = max(1, _sf_pool.max_retries + 1)

    for _ in range(attempts):
        account = _sf_pool.acquire(user_ctx=user_ctx, wait_timeout=max(1.0, _sf_pool.cooldown_seconds + 1.0))
        try:
            headers = _auth_headers(account, kwargs.pop('headers', None))
            response = requests.request(
                method=method,
                url=_build_url(account.base, path),
                timeout=timeout,
                headers=headers,
                **kwargs,
            )
            last_response = response
            if 200 <= response.status_code < 300:
                _sf_pool.report_success(account)
                return response

            _sf_pool.report_failure(account, response.status_code)
            if response.status_code not in (401, 403, 429, 500, 502, 503, 504):
                return response
        except requests.RequestException as exc:
            last_error = exc
            _sf_pool.report_failure(account, 0)
        finally:
            _sf_pool.release(account)

    if last_response is not None:
        return last_response
    raise last_error or RuntimeError('SiliconFlow 请求失败')


def _build_client(pool: KeyPool, user_ctx: Optional[dict]):
    account = pool.acquire(user_ctx=user_ctx, wait_timeout=max(1.0, pool.cooldown_seconds + 1.0))
    client = OpenAI(
        api_key=account.key,
        base_url=account.base,
        timeout=10.0,
        max_retries=0,
    )
    client._keypool_account = account
    client._keypool_pool = pool
    client._keypool_released = False
    return client


def get_sf_client(user_ctx: Optional[dict] = None):
    return _build_client(_sf_pool, user_ctx)


def get_gemini_client(user_ctx: Optional[dict] = None):
    return _build_client(_gemini_pool, user_ctx)


def _report_client(client: Any, status_code: int, success: bool) -> None:
    pool = getattr(client, '_keypool_pool', None)
    account = getattr(client, '_keypool_account', None)
    if not pool or not account or getattr(client, '_keypool_released', False):
        return

    if success:
        pool.report_success(account)
    else:
        pool.report_failure(account, status_code)
    pool.release(account)
    client._keypool_released = True


def report_sf_success(client: Any, route: str, attempt: int, latency_ms: int, retries: int) -> None:
    del route, attempt, latency_ms, retries
    _report_client(client, 200, True)


def report_sf_failure(client: Any, status_code: int, route: str, attempt: int, latency_ms: int, retries: int) -> None:
    del route, attempt, latency_ms, retries
    _report_client(client, status_code, False)


def report_gemini_success(client: Any, route: str, attempt: int, latency_ms: int, retries: int) -> None:
    del route, attempt, latency_ms, retries
    _report_client(client, 200, True)


def report_gemini_failure(client: Any, status_code: int, route: str, attempt: int, latency_ms: int, retries: int) -> None:
    del route, attempt, latency_ms, retries
    _report_client(client, status_code, False)


reload_keypools_from_env()


__all__ = [
    'get_gemini_client',
    'get_sf_client',
    'pools_stats',
    'reload_keypools_from_env',
    'report_gemini_failure',
    'report_gemini_success',
    'report_sf_failure',
    'report_sf_success',
    'sf_request',
    '_sf_pool',
]
