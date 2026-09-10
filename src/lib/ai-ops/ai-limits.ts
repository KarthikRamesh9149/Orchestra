import type { AiLimitCode } from "./ai-ops-schemas.js";
import Redis from "ioredis";

export interface LimitDecision {
  allowed: boolean;
  code: AiLimitCode;
  remaining?: number;
  retryAfterMs?: number;
  deniedKey?: string;
}

export type DailyCostLimitInput = {
  key: string;
  maxDailyCostUsd: number | null | undefined;
  addCostUsd: number;
  now?: Date;
};

export interface AiLimiter {
  checkRequestLimit(input: { key: string; maxRequests: number; windowMs: number; nowMs?: number }): LimitDecision | Promise<LimitDecision>;
  acquireConcurrent(key: string, maxConcurrent: number): LimitDecision | Promise<LimitDecision>;
  releaseConcurrent(key: string): void | Promise<void>;
  checkDailyCost(input: { key: string; maxDailyCostUsd: number | null | undefined; addCostUsd: number; now?: Date }): LimitDecision | Promise<LimitDecision>;
  checkDailyCosts(inputs: DailyCostLimitInput[]): LimitDecision | Promise<LimitDecision>;
}

export class InMemoryAiLimiter {
  private readonly requestWindows = new Map<string, number[]>();
  private readonly concurrent = new Map<string, number>();
  private readonly dailyCost = new Map<string, { day: string; cost: number }>();

  checkRequestLimit(input: { key: string; maxRequests: number; windowMs: number; nowMs?: number }): LimitDecision {
    const now = input.nowMs ?? Date.now();
    const active = (this.requestWindows.get(input.key) ?? []).filter((timestamp) => now - timestamp < input.windowMs);
    if (active.length >= input.maxRequests) {
      return {
        allowed: false,
        code: input.key.startsWith("project:") ? "socrates_project_rate_limited" : "socrates_rate_limited",
        remaining: 0,
        retryAfterMs: input.windowMs - (now - active[0])
      };
    }
    active.push(now);
    this.requestWindows.set(input.key, active);
    return { allowed: true, code: "allowed", remaining: Math.max(0, input.maxRequests - active.length) };
  }

  acquireConcurrent(key: string, maxConcurrent: number): LimitDecision {
    const current = this.concurrent.get(key) ?? 0;
    if (current >= maxConcurrent) {
      return { allowed: false, code: "socrates_stream_limit_exceeded", remaining: 0 };
    }
    this.concurrent.set(key, current + 1);
    return { allowed: true, code: "allowed", remaining: Math.max(0, maxConcurrent - current - 1) };
  }

  releaseConcurrent(key: string) {
    const current = this.concurrent.get(key) ?? 0;
    if (current <= 1) this.concurrent.delete(key);
    else this.concurrent.set(key, current - 1);
  }

  checkDailyCost(input: { key: string; maxDailyCostUsd: number | null | undefined; addCostUsd: number; now?: Date }): LimitDecision {
    return this.checkDailyCosts([input]);
  }

  checkDailyCosts(inputs: DailyCostLimitInput[]): LimitDecision {
    const limited = inputs.filter((input) => input.maxDailyCostUsd != null && input.maxDailyCostUsd > 0);
    const pending = limited.map((input) => {
      const day = (input.now ?? new Date()).toISOString().slice(0, 10);
      const existing = this.dailyCost.get(input.key);
      const current = existing?.day === day ? existing.cost : 0;
      return { input, day, current };
    });
    const denied = pending.find(({ input, current }) => current + input.addCostUsd > Number(input.maxDailyCostUsd));
    if (denied) {
      return {
        allowed: false,
        code: "socrates_cost_budget_exceeded",
        deniedKey: denied.input.key,
        remaining: Math.max(0, Number(denied.input.maxDailyCostUsd) - denied.current)
      };
    }
    for (const { input, day, current } of pending) {
      this.dailyCost.set(input.key, { day, cost: current + input.addCostUsd });
    }
    return { allowed: true, code: "allowed" };
  }
}

export class RedisAiLimiter implements AiLimiter {
  private readonly redis: {
    zremrangebyscore: (...args: unknown[]) => Promise<unknown>;
    zadd: (...args: unknown[]) => Promise<unknown>;
    pexpire: (...args: unknown[]) => Promise<unknown>;
    zcard: (...args: unknown[]) => Promise<number>;
    zrem: (...args: unknown[]) => Promise<unknown>;
    zrange: (...args: unknown[]) => Promise<string[]>;
    incr: (...args: unknown[]) => Promise<number>;
    expire: (...args: unknown[]) => Promise<unknown>;
    decr: (...args: unknown[]) => Promise<number>;
    del: (...args: unknown[]) => Promise<unknown>;
    incrbyfloat: (...args: unknown[]) => Promise<string | number>;
    eval: (...args: unknown[]) => Promise<unknown>;
  };
  private readonly prefix: string;

  constructor(redisUrl: string, prefix = "orchestra:ai-limits") {
    this.redis = new (Redis as any)(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false
    });
    this.prefix = prefix;
  }

  async checkRequestLimit(input: { key: string; maxRequests: number; windowMs: number; nowMs?: number }): Promise<LimitDecision> {
    const now = input.nowMs ?? Date.now();
    const key = `${this.prefix}:requests:${input.key}`;
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await this.redis.zremrangebyscore(key, 0, now - input.windowMs);
    await this.redis.zadd(key, now, member);
    await this.redis.pexpire(key, input.windowMs * 2);
    const count = await this.redis.zcard(key);
    if (count > input.maxRequests) {
      await this.redis.zrem(key, member);
      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestScore = oldest[1] ? Number(oldest[1]) : now;
      return {
        allowed: false,
        code: input.key.startsWith("project:") ? "socrates_project_rate_limited" : "socrates_rate_limited",
        remaining: 0,
        retryAfterMs: Math.max(0, input.windowMs - (now - oldestScore))
      };
    }
    return { allowed: true, code: "allowed", remaining: Math.max(0, input.maxRequests - count) };
  }

  async acquireConcurrent(key: string, maxConcurrent: number): Promise<LimitDecision> {
    const redisKey = `${this.prefix}:concurrent:${key}`;
    const current = await this.redis.incr(redisKey);
    await this.redis.expire(redisKey, 60 * 60);
    if (current > maxConcurrent) {
      await this.redis.decr(redisKey);
      return { allowed: false, code: "socrates_stream_limit_exceeded", remaining: 0 };
    }
    return { allowed: true, code: "allowed", remaining: Math.max(0, maxConcurrent - current) };
  }

  async releaseConcurrent(key: string): Promise<void> {
    const redisKey = `${this.prefix}:concurrent:${key}`;
    const current = await this.redis.decr(redisKey);
    if (current <= 0) {
      await this.redis.del(redisKey);
    }
  }

  async checkDailyCost(input: { key: string; maxDailyCostUsd: number | null | undefined; addCostUsd: number; now?: Date }): Promise<LimitDecision> {
    return this.checkDailyCosts([input]);
  }

  async checkDailyCosts(inputs: DailyCostLimitInput[]): Promise<LimitDecision> {
    const limited = inputs.filter((input) => input.maxDailyCostUsd != null && input.maxDailyCostUsd > 0);
    if (limited.length === 0) return { allowed: true, code: "allowed" };
    const keys = limited.map((input) => {
      const day = (input.now ?? new Date()).toISOString().slice(0, 10);
      return `${this.prefix}:cost:${day}:${input.key}`;
    });
    const args = limited.flatMap((input) => [String(input.addCostUsd), String(input.maxDailyCostUsd)]);
    const script = `
      for i = 1, #KEYS do
        local current = tonumber(redis.call('GET', KEYS[i]) or '0')
        local add = tonumber(ARGV[(i - 1) * 2 + 1])
        local maximum = tonumber(ARGV[(i - 1) * 2 + 2])
        if current + add > maximum then return {0, i, current} end
      end
      for i = 1, #KEYS do
        redis.call('INCRBYFLOAT', KEYS[i], ARGV[(i - 1) * 2 + 1])
        redis.call('EXPIRE', KEYS[i], 172800)
      end
      return {1, 0, 0}
    `;
    const raw = await this.redis.eval(script, keys.length, ...keys, ...args);
    const result = Array.isArray(raw) ? raw.map(Number) : [0, 1, 0];
    if (result[0] !== 1) {
      const index = Math.max(0, (result[1] ?? 1) - 1);
      const denied = limited[index]!;
      return {
        allowed: false,
        code: "socrates_cost_budget_exceeded",
        deniedKey: denied.key,
        remaining: Math.max(0, Number(denied.maxDailyCostUsd) - (result[2] ?? 0))
      };
    }
    return { allowed: true, code: "allowed" };
  }
}

export function createAiLimiter(input: { redisUrl?: string; prefix?: string; nodeEnv?: string }): AiLimiter {
  if (input.redisUrl && input.nodeEnv === "production") {
    return new RedisAiLimiter(input.redisUrl, input.prefix);
  }
  return new InMemoryAiLimiter();
}
