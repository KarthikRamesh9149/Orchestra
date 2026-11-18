-- Keep persisted project projections shared. Personal Socrates history is read
-- separately under session ownership and never written back to these snapshots.
WITH projections AS (
  SELECT id, scope, payload_json::jsonb AS payload,
         CASE WHEN scope = 'mission_control' THEN payload_json::jsonb
              ELSE payload_json::jsonb -> 'missionControl' END AS mission_control
  FROM dashboard_snapshots
  WHERE scope IN ('mission_control', 'project')
), clean AS (
  SELECT id, scope, payload, mission_control || jsonb_build_object(
    'activity', activity.items,
    'socratesQueries', '[]'::jsonb,
    'featureStates', COALESCE(mission_control -> 'featureStates', '{}'::jsonb) || jsonb_build_object(
      'socrates', 'empty',
      'activity', CASE WHEN jsonb_array_length(activity.items) = 0 THEN 'empty' ELSE 'ready' END
    )
  ) AS sanitized
  FROM projections
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(item ORDER BY ordinal), '[]'::jsonb) AS items
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(mission_control -> 'activity') = 'array'
           THEN mission_control -> 'activity' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS activity_item(item, ordinal)
    WHERE item ->> 'source' IS DISTINCT FROM 'socrates'
  ) AS activity
  WHERE jsonb_typeof(mission_control) = 'object'
)
UPDATE dashboard_snapshots AS snapshot
SET payload_json = CASE WHEN clean.scope = 'mission_control' THEN clean.sanitized
                        ELSE jsonb_set(clean.payload, '{missionControl}', clean.sanitized) END
FROM clean
WHERE snapshot.id = clean.id
  AND (CASE WHEN clean.scope = 'mission_control' THEN clean.payload
            ELSE clean.payload -> 'missionControl' END) IS DISTINCT FROM clean.sanitized;
