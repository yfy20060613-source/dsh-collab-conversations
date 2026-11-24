/**
 * Session Bus — cross-session dispatch and read-back for DeepSeek Harness.
 *
 * Gives one conversation tools that address *sibling* conversations by session
 * id: list them, hand one a task, and read its conclusions back. The target
 * keeps its own context window — only an explicit message and an explicit
 * projection travel between sessions, never a transcript.
 *
 * Boundaries:
 * - A delivered task is DATA. It never widens the receiver's permissions.
 * - `session_read` uses `sessionQuery.readSurface()`, which reads a cold log
 *   without making it live — reading never resumes, never allocates a driver,
 *   and never takes ownership of another session's lifecycle.
 * - Dispatch depth is carried per task chain and floored by the SDK's durable
 *   `SessionHeader.delegationDepth`, so a reply does not ratchet the chain.
 *
 * @module dsh-plugin-session-bus
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "session-bus";
export declare const inject: string[];
/**
 * Who is allowed to hand out tasks.
 *
 * - `star` (default): only a session that has no inbound task of its own may
 *   dispatch. A delegate may report back to the origin that assigned it, and a
 *   hand-off to anyone else is refused — the depth budget can never be spent by
 *   a chain nobody authorised.
 * - `chain`: any session may hand off; every hand-off opens a child chain one
 *   hop deeper, and `maxHops` is the only bound.
 */
export type Topology = 'star' | 'chain';
/** Deployment policy for cross-session dispatch. */
export interface Config {
    /** Dispatch topology. */
    topology?: Topology;
    /** Maximum dispatch hops before a chain is refused. */
    maxHops?: number;
    /** Resume a persisted session that receives a task. OFF by default: see README. */
    wakeOnColdSession?: boolean;
    /** Default wake policy when the caller omits `wake`. */
    defaultWake?: boolean;
    /** Default number of trailing messages returned by `session_read`. */
    readTailMessages?: number;
    /** Default character budget for one `session_read` result. */
    readMaxChars?: number;
    /** Include subagent-origin sessions in `session_list`. */
    includeSubagents?: boolean;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    topology: z<"star" | "chain", "star" | "chain", "defined">;
    maxHops: z<number, number, "defined">;
    wakeOnColdSession: z<boolean, boolean, "defined">;
    defaultWake: z<boolean, boolean, "defined">;
    readTailMessages: z<number, number, "defined">;
    readMaxChars: z<number, number, "defined">;
    includeSubagents: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    topology: z<"star" | "chain", "star" | "chain", "defined">;
    maxHops: z<number, number, "defined">;
    wakeOnColdSession: z<boolean, boolean, "defined">;
    defaultWake: z<boolean, boolean, "defined">;
    readTailMessages: z<number, number, "defined">;
    readMaxChars: z<number, number, "defined">;
    includeSubagents: z<boolean, boolean, "defined">;
}>>, "plain">;
/**
 * Register the session-bus tools.
 *
 * @param ctx - plugin context carrying agents, sessions, sessionQuery, and tools.
 * @param config - deployment policy for hops, wakeup, and read budgets.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
