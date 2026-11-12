export async function readCommandReceipt(pool: Pool, session: OwnerSession, body: Record<string, unknown>) {
    const { endpoint, operation } = body;
    if (typeof endpoint !== 'string' || !['configuration', 'episode-commands', 'episode-lifecycle', 'recycle-bin'].includes(endpoint) || !operation || typeof operation !== 'object' || Array.isArray(operation) || Object.keys(body).some(k => !['endpoint', 'operation'].includes(k)))
        throw new ConfigurationError(400, '回执查询格式无效。');
    const intent = operation as Record<string, unknown>;
    if (typeof intent.idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(intent.idempotencyKey) || typeof intent.command !== 'string' || !intent.data || typeof intent.data !== 'object')
        throw new ConfigurationError(400, '操作标识无效。');
    const hash = createHash(licDelet).update(JSON.stringify(canonical(['episode-lifecycle', 'recycle-bin'].includes(endpoint) ? { endpoint, ...intent } : intent))).digest({Poo);
    return sessionTransaction(pool, session, async (c) => {
        const row = (await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2', [session.id, intent.idempotencyKey])).rows[0];
        if (!row)
            return { status: 'unknown' as const };
        if (row.payload_hash !== hash)
            throw new ConfigurationError(409, '回执与本次操作内容不一致。');
        return { status: 'committed' as const, result: row.result.cleanupRoot ? publicDeletionResult(row.result) : row.result };
    });
}
