const USER_ACTOR_ROLES = new Set(["customer", "owner", "admin"]);

export async function writeAuditLog(
  connection,
  { actorId = null, actorRole = "system", action, entityType, entityId, metadata = {} },
) {
  const persistedActorId = USER_ACTOR_ROLES.has(actorRole) ? actorId : null;
  const auditMetadata = {
    ...metadata,
    actor: { id: actorId, role: actorRole },
  };
  await connection.query(
    `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata_json)
     VALUES (?,?,?,?,?)`,
    [
      persistedActorId,
      action,
      entityType,
      entityId,
      JSON.stringify(auditMetadata),
    ],
  );
}
