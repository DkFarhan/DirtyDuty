-- Read-only audit of notification events. Changes no data.
--
-- Run it on production from /opt/dirtyduty (PROJECT=dirtyduty), read-only twice over: the
-- session refuses writes (default_transaction_read_only) and the script runs inside a READ ONLY
-- transaction that it rolls back:
--
--   docker compose -p dirtyduty -f docker-compose.production.yml --env-file .env.production \
--     exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
--     sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 -f -' \
--     < scripts/readonly/notification-events-audit.sql
--
-- Caveat for section 2: notifications that were read more than 90 days ago are deleted by
-- retention (their event's link goes with them), so an old event "without a notification" may
-- have had one. Events are counted by whether any notification row still points at them.

\set QUIET on
\pset footer off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '2s';
\set QUIET off

\echo '== 1. Notification events by type and month (UTC) =='
SELECT event_type,
       to_char(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
       COUNT(*) AS events,
       COUNT(*) FILTER (WHERE processed_at IS NULL) AS unprocessed
FROM notification_events
GROUP BY event_type, date_trunc('month', created_at AT TIME ZONE 'UTC')
ORDER BY month, event_type;

\echo '== 2. Events that never produced a notification, by type =='
SELECT e.event_type,
       COUNT(*) AS events_without_notification,
       MIN(e.created_at) AS first_seen,
       MAX(e.created_at) AS last_seen
FROM notification_events e
WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.event_id = e.id)
GROUP BY e.event_type
ORDER BY events_without_notification DESC, e.event_type;

\echo '== 2b. Share of all events without a notification =='
SELECT COUNT(*) AS all_events,
       COUNT(*) FILTER (WHERE linked.event_id IS NULL) AS without_notification
FROM notification_events e
LEFT JOIN (
    SELECT DISTINCT event_id FROM notifications WHERE event_id IS NOT NULL
) linked ON linked.event_id = e.id;

\echo '== 3. Table and index size =='
SELECT c.relname AS table_name,
       c.reltuples::bigint AS estimated_rows,
       pg_size_pretty(pg_table_size(c.oid)) AS table_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = current_schema()
  AND c.relkind = 'r'
  AND c.relname IN ('notification_events', 'notifications', 'notification_deliveries',
                    'notification_push_delivery_targets', 'notification_push_digests')
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo '== 3b. Index sizes on notification_events =='
SELECT indexrelid::regclass AS index_name,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_index
WHERE indrelid = 'notification_events'::regclass
ORDER BY pg_relation_size(indexrelid) DESC;

ROLLBACK;
