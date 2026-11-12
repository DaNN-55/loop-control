export async function readEpisodeCollection(c: Pick<PoolClient, 'query'>, mediaRoot: string, episodeId: string) {
    const episode = (await c.query('SELECT e.account_id,e.series_version_id,v.series_id,v.version,s.name FROM public.episodes e LEFT JOIN public.series_versions v ON v.id=e.series_version_id LEFT JOIN public.series s ON s.id=v.series_id JOIN public.account_memberships m ON m.account_id=e.account_id AND m.user_id=local_identity.owner_id() AND m.role=\'owner\' WHERE e.id=$1', [episodeId])).rows[0];
    if (!episode)
        throw new ConfigurationError(404, '生产单不可见。');
    const location = await resolveEpisodeStorageLocation(c, mediaRoot, episodeId), collection = await resolveEpisodeStorageCollection(c, location);
    let reason: string | undefined;
    try {
        await requireEpisodeStorageDirectory(c, location);
    }
    catch (error) {
        reason = (error as Error).message;
    }
    const targets = (await c.query('SELECT s.id "seriesId",s.name,c.id "containerId" FROM public.series s LEFT JOIN local_identity.account_storage_containers c ON c.account_id=s.account_id AND c.series_id=s.id WHERE s.account_id=$1 ORDER BY s.name,s.id', [episode.account_id])).rows;
    const unassigned = (await c.query("SELECT id FROM local_identity.account_storage_containers WHERE account_id=$1 AND kind='unassigned'", [episode.account_id])).rows[0];
    const plans = (await c.query("SELECT id,status,manifest,error FROM local_identity.account_directory_migrations WHERE account_id=$1 AND manifest->>'kind'='move' AND manifest#>>'{episodes,0,id}'=$2 ORDER BY created_at DESC LIMIT 1", [episode.account_id, episodeId])).rows.map(row => ({ id: row.id, status: row.status, ...row.manifest, error: row.error }));
    const currentName = collection.status === 'registered' ? (collection.container.seriesId ? targets.find(target => target.seriesId === collection.container.seriesId)?.name ?? '系列不可用' : '未分系列') : episode.name ?? (episode.series_version_id ? '创作系列不可用' : '未分系列');
    return { episodeId, accountId: episode.account_id, directoryPath: location.directoryPath, collection: { status: collection.status, seriesId: collection.status === 'registered' ? collection.container.seriesId : episode.series_id ?? null, name: currentName, reason }, creative: { seriesVersionId: episode.series_version_id, seriesId: episode.series_id ?? null, name: episode.name ?? null, version: episode.version ?? null }, targets: [...targets, { seriesId: null, name: '未分系列', containerId: unassigned?.id ?? null }], plans };
}
export async function planEpisodeCollectionCommand(pool: Pool, session: OwnerSession, mediaRoot: string, body: Record<string, unknown>, episodeId: string, seriesId: string | null) {
    const key = String(body.idempotencyKey), hash = createHash({Pool,P).update(JSON.stringify(canonical(body))).digest(:cryp);
    const receipt = async (c: Pick<PoolClient, 'query'>) => { const row = (await c.query('SELECT payload_hash,result FROM local_identity.command_receipts WHERE owner_id=$1 AND idempotency_key=$2', [session.id, key])).rows[0]; if (row && row.payload_hash !== hash)
        throw new ConfigurationError(409, '同一操作标识不能用于不同内容。'); return row; };
    const prepared = await sessionTransaction(pool, session, async (c) => { const previous = await receipt(c); if (previous)
        return { previous }; const state = await readEpisodeCollection(c, mediaRoot, episodeId); if (state.collection.status !== 'registered' || state.collection.reason)
        throw new ConfigurationError(409, state.collection.reason ?? '请先在账号中盘点旧资料纳管，再调整系列。'); return { accountId: state.accountId, prepare: seriesId === null && !state.targets.find(target => target.seriesId === null)?.containerId }; });
    if (!('previous' in prepared) && prepared.prepare) {
        const bytes = createHash('sha256').update(session.id + ':collection-unassigned:' + key).digest('hex').slice(0, 32), containerKey = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20)}`;
        await createStorageContainer(pool, session, containerKey, hash, { accountId: prepared.accountId }, mediaRoot, 'unassigned');
    }
    return sessionTransaction(pool, session, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [session.id + ':' + key]);
        const previous = await receipt(c);
        if (previous) {
            await readEpisodeCollection(c, mediaRoot, episodeId);
            const row = (await c.query('SELECT id,status,manifest,error FROM local_identity.account_directory_migrations WHERE id=$1', [previous.result.id])).rows[0];
            if (!row)
                throw new ConfigurationError(409, '系列调整计划已不存在，请重新盘点。');
            return { id: row.id, status: row.status, ...row.manifest, error: row.error };
        }
        const plan = await planEpisodeCollectionMove(c, mediaRoot, episodeId, seriesId);
        await c.query('INSERT INTO local_identity.command_receipts(owner_id,idempotency_key,payload_hash,result) VALUES($1,$2,$3,$4)', [session.id, key, hash, { id: plan.id }]);
        return plan;
    });
}
