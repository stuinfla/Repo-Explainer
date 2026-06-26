#!/bin/bash
# Usage: ./scripts/update-gist-status.sh <gist_id> <step> <total_steps> <step_name> <status> [error]
# Updates a GitHub Gist with pipeline progress as JSON.
# Requires: GITHUB_TOKEN or GH_PAT environment variable, curl, jq.

set -euo pipefail

GIST_ID="${1:?Missing gist_id}"
STEP="${2:?Missing step}"
TOTAL_STEPS="${3:?Missing total_steps}"
STEP_NAME="${4:?Missing step_name}"
STATUS="${5:?Missing status}"
ERROR="${6:-null}"
BUILD_ID="${BUILD_ID:-unknown}"

TOKEN="${GH_PAT:-${GITHUB_TOKEN:-}}"
if [[ -z "$TOKEN" ]]; then
  echo "::error::No GitHub token found (GH_PAT or GITHUB_TOKEN)"
  exit 1
fi

# Quote error as JSON string if non-null
if [[ "$ERROR" != "null" ]]; then
  ERROR="$(jq -n --arg e "$ERROR" '$e')"
else
  ERROR="null"
fi

STARTED_AT="${STARTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

PAYLOAD=$(jq -n \
  --arg buildId "$BUILD_ID" \
  --argjson step "$STEP" \
  --argjson totalSteps "$TOTAL_STEPS" \
  --arg stepName "$STEP_NAME" \
  --arg status "$STATUS" \
  --arg startedAt "$STARTED_AT" \
  --argjson error "$ERROR" \
  '{
    buildId: $buildId,
    step: $step,
    totalSteps: $totalSteps,
    stepName: $stepName,
    status: $status,
    startedAt: $startedAt,
    error: $error,
    result: null
  }')

# Wrap payload for gist update: file "status.json" with content as string
GIST_BODY=$(jq -n --arg content "$PAYLOAD" '{files: {"status.json": {content: $content}}}')

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PATCH \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "$GIST_BODY" \
  "https://api.github.com/gists/$GIST_ID")

if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
  echo "Gist updated: step $STEP/$TOTAL_STEPS — $STEP_NAME ($STATUS)"
else
  echo "::warning::Gist update returned HTTP $HTTP_CODE"
fi
