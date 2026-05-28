"use strict";

const { mediaSourceUrlKindFields } = require("../../media-source-url-kind");
const { normaliseText } = require("../../text-hygiene");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function cleanText(value) {
  return normaliseText(String(value || "")).replace(/\s+/g, " ").trim();
}

function normaliseFamily(value) {
  return (
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function normaliseMatchText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function titleContainsSpecificEntity(titleText, entity) {
  const normalised = normaliseMatchText(entity);
  if (!normalised || !titleText.includes(normalised)) return false;
  return normalised.split(" ").filter((token) => token.length > 1).length >= 2;
}

function stripSourceSuffix(title = "") {
  return cleanText(title).replace(
    /\s*[-–—]\s*(?:digital foundry|ign|gamespot|eurogamer|vgc|gamesradar|rock paper shotgun|pc gamer|polygon|kotaku|nintendo life|push square|pure xbox|thegamer|game rant|wccftech)\s*$/i,
    "",
  );
}

function looksLikeSpecificGameEntity(value = "") {
  const text = cleanText(value)
    .replace(/^["'“”‘’]+|["'“”‘’.,:;!?]+$/g, "")
    .trim();
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return false;
  const weakFirstWords = new Set([
    "it",
    "it's",
    "this",
    "that",
    "what",
    "why",
    "how",
    "new",
    "the",
    "a",
    "an",
  ]);
  if (weakFirstWords.has(tokens[0].toLowerCase())) return false;
  return tokens.some((token) => /[A-Z0-9]/.test(token[0] || ""));
}

function cleanPotentialGameEntity(value = "") {
  return cleanText(value)
    .replace(/^["'“”‘’]+|["'“”‘’.,:;!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function knownGameAliasFromText(value = "") {
  const text = cleanText(value);
  if (/\bFH6\b/i.test(text)) return "Forza Horizon 6";
  if (/\bFH5\b/i.test(text)) return "Forza Horizon 5";
  if (/\bFH4\b/i.test(text)) return "Forza Horizon 4";
  if (/\bSuper Mario RPG\b/i.test(text)) return "Super Mario RPG";
  if (/\bPok(?:e|\u00e9|\u00c3\u00a9)mon Go\b/i.test(text)) return "Pok\u00e9mon Go";
  if (/\bSteam Controller\b/i.test(text)) return "Steam Controller";
  if (/\bSteam Deck\b/i.test(text)) return "Steam Deck";
  if (/\bNintendo Switch 2\b/i.test(text)) return "Nintendo Switch 2";
  return "";
}

function extractGameEntityFromTitle(title = "") {
  const text = stripSourceSuffix(title);
  const aliasEntity = knownGameAliasFromText(text);
  if (aliasEntity) return aliasEntity;
  const patterns = [
    /\b(?:and|says|reveals|confirms|reports|claims|after)\s+(.+?)\s+(?:is|are|was|were|has|have|gets|got|will|won't|would|could|can|still|just|now)\b/i,
    /^(.+?)\s+(?:is|are|was|were|has|have|gets|got|will|won't|would|could|can|still|just|now)\b/i,
    /^(.+?)\s*:/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanPotentialGameEntity(match?.[1]);
    if (looksLikeSpecificGameEntity(candidate)) return candidate;
  }
  return "";
}

function storyIdFromPack(pack = {}) {
  return firstText(pack.story_id, pack.storyId, pack.id);
}

function directVideoEnrichmentStoryIds(workOrder = {}) {
  return new Set(
    asArray(workOrder.jobs)
      .filter((job) => {
        const typeText = workOrderJobText(job);
        return (
          typeText.includes("direct video enrichment") ||
          typeText.includes("direct video motion missing")
        );
      })
      .map((job) => cleanText(job.story_id || job.storyId || job.id))
      .filter(Boolean),
  );
}

function workOrderJobText(job = {}) {
  return normaliseMatchText(
    [
      job.repair_lane,
      job.blocker_type,
      job.exact_missing_input,
      ...asArray(job.blockers),
      ...asArray(job.actions).flatMap((action) => [
        action.action_id,
        action.repair_lane,
        action.status,
        action.exact_missing_input,
      ]),
    ].join(" "),
  );
}

function workOrderJobsByStoryId(workOrder = {}) {
  const map = new Map();
  for (const job of asArray(workOrder.jobs)) {
    const storyId = cleanText(job.story_id || job.storyId || job.id);
    if (!storyId) continue;
    if (!map.has(storyId)) map.set(storyId, []);
    map.get(storyId).push(job);
  }
  return map;
}

function workOrderJobActions(job = {}) {
  return asArray(job.actions);
}

function workOrderJobHasStatus(job = {}, status) {
  const target = cleanText(status);
  if (!target) return false;
  if (cleanText(job.status) === target) return true;
  return workOrderJobActions(job).some((action) => cleanText(action.status) === target);
}

function workOrderJobIsRejectRecommended(job = {}) {
  return workOrderJobHasStatus(job, "reject_recommended");
}

function workOrderJobIsDeadEnd(job = {}) {
  if (job.dead_end_blocker === true) return true;
  if (workOrderJobIsRejectRecommended(job)) return true;
  return workOrderJobActions(job).some((action) => action.dead_end_blocker === true);
}

function workOrderJobIsOperatorRequired(job = {}) {
  if (job.operator_approval_required === true || job.operator_approval_needed === true) return true;
  return workOrderJobActions(job).some(
    (action) =>
      action.operator_approval_required === true ||
      action.operator_approval_needed === true ||
      ["operator_required", "reject_recommended"].includes(cleanText(action.status)),
  );
}

function uniqueCleanTexts(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function workOrderMetadataForJobs(jobs = []) {
  const jobList = asArray(jobs);
  return {
    render_input_dead_end_blocker: jobList.some(workOrderJobIsDeadEnd),
    render_input_operator_required: jobList.some(workOrderJobIsOperatorRequired),
    render_input_reject_recommended: jobList.some(workOrderJobIsRejectRecommended),
    render_input_statuses: uniqueCleanTexts(jobList.map((job) => job.status)),
    render_input_blockers: uniqueCleanTexts(
      jobList.flatMap((job) => [
        ...asArray(job.blockers),
        ...workOrderJobActions(job).flatMap((action) => asArray(action.reason_codes)),
      ]),
    ),
    render_input_repair_lanes: uniqueCleanTexts(
      jobList.flatMap((job) => [
        job.repair_lane,
        ...workOrderJobActions(job).map((action) => action.repair_lane),
      ]),
    ),
  };
}

function realVisualAfterFailedOwnedExplainerStoryIds(workOrder = {}) {
  return new Set(
    asArray(workOrder.jobs)
      .filter((job) => {
        const typeText = workOrderJobText(job);
        return (
          typeText.includes("real visual media required after owned explainer deck failed benchmark") ||
          (
            typeText.includes("generated only motion deck") &&
            typeText.includes("no real visual media asset")
          )
        );
      })
      .map((job) => cleanText(job.story_id || job.storyId || job.id))
      .filter(Boolean),
  );
}

function markDirectVideoEnrichmentRequests(packs = [], workOrder = {}) {
  const requestedStoryIds = directVideoEnrichmentStoryIds(workOrder);
  const realVisualRequiredStoryIds = realVisualAfterFailedOwnedExplainerStoryIds(workOrder);
  const jobsByStoryId = workOrderJobsByStoryId(workOrder);
  if (!requestedStoryIds.size && !realVisualRequiredStoryIds.size && !jobsByStoryId.size) {
    return asArray(packs);
  }
  return asArray(packs).map((pack) => {
    const storyId = storyIdFromPack(pack);
    const workOrderMetadata = workOrderMetadataForJobs(jobsByStoryId.get(storyId) || []);
    if (
      !requestedStoryIds.has(storyId) &&
      !realVisualRequiredStoryIds.has(storyId) &&
      !jobsByStoryId.has(storyId)
    ) {
      return pack;
    }
    return {
      ...pack,
      direct_video_enrichment_requested:
        requestedStoryIds.has(storyId) || pack.direct_video_enrichment_requested === true,
      real_visual_media_required_after_owned_explainer_failed:
        realVisualRequiredStoryIds.has(storyId) ||
        pack.real_visual_media_required_after_owned_explainer_failed === true,
      ...workOrderMetadata,
    };
  });
}

function packEntitySupportText(referencePlan = {}, pack = {}) {
  return normaliseMatchText(
    [
      pack.title,
      pack.canonical_subject,
      pack.canonical_game,
      pack.game,
      referencePlan.title,
      ...asArray(referencePlan.target_entities),
      ...asArray(referencePlan.source_proof_covered_target_entities),
      ...asArray(referencePlan.covered_target_entities),
      ...asArray(referencePlan.verified_store_targets).map((target) => target.entity),
      ...asArray(referencePlan.planned_searches).flatMap((search) => [search.entity, search.query]),
    ].join(" "),
  );
}

function packTextSupportsEntity(entity, pack = {}, referencePlan = {}) {
  const target = normaliseMatchText(entity);
  if (!target) return false;
  const supportText = packEntitySupportText(referencePlan, pack);
  if (!supportText) return false;
  if (supportText.includes(target)) return true;
  const tokens = target.split(" ").filter((token) => token.length > 2);
  return tokens.length >= 2 && tokens.every((token) => supportText.includes(token));
}

function referencePlanStoryEntities(referencePlan = {}, pack = {}) {
  const entities = [];
  const clipBackedEntities = [];
  const titleText = normaliseMatchText(referencePlan.title || pack.title);
  function canAddEntity(entity) {
    return (
      !clipBackedEntities.length ||
      sourceEntityMatchesStoryEntities(entity, clipBackedEntities)
    );
  }
  function addEntity(entity) {
    const text = cleanText(entity);
    if (text && canAddEntity(text)) entities.push(text);
  }
  for (const clip of asArray(pack.clips)) {
    if (cleanText(clip.entity) && packTextSupportsEntity(clip.entity, pack, referencePlan)) {
      const text = cleanText(clip.entity);
      entities.push(text);
      clipBackedEntities.push(text);
    }
  }
  for (const reference of asArray(referencePlan.references)) {
    const entity = firstText(reference.entity, reference.canonical_subject, reference.game, reference.title_entity);
    if (titleContainsSpecificEntity(titleText, entity)) addEntity(entity);
  }
  for (const entity of asArray(referencePlan.source_proof_covered_target_entities)) {
    addEntity(entity);
  }
  for (const entity of asArray(referencePlan.covered_target_entities)) {
    addEntity(entity);
  }
  for (const target of asArray(referencePlan.verified_store_targets)) {
    addEntity(target.entity);
  }

  for (const entity of asArray(referencePlan.target_entities)) {
    const normalised = normaliseMatchText(entity);
    if (normalised && titleText.includes(normalised)) addEntity(entity);
  }
  for (const item of asArray(pack.trusted_source_pipeline?.intake_queue)) {
    for (const entity of [item.entity, ...asArray(item.entities)]) {
      if (titleContainsSpecificEntity(titleText, entity)) addEntity(entity);
    }
  }

  const seen = new Set();
  return entities.filter((entity) => {
    const key = normaliseMatchText(entity);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackSearchEntityForPack(pack = {}, referencePlan = {}) {
  const fromReferencePlan = referencePlanStoryEntities(referencePlan, pack)[0];
  if (fromReferencePlan) return fromReferencePlan;
  const aliasEntity = knownGameAliasFromText(pack.title);
  if (aliasEntity) return aliasEntity;
  const titleText = normaliseMatchText(pack.title);
  for (const value of [pack.canonical_subject, pack.canonical_game, pack.game]) {
    const text = cleanText(value);
    if (!text) continue;
    if (normaliseMatchText(text) === titleText) continue;
    if (looksLikeSpecificGameEntity(text)) return text;
  }
  return extractGameEntityFromTitle(pack.title);
}

function primaryEntityForPack(pack = {}, referencePlan = {}) {
  return (
    referencePlanStoryEntities(referencePlan, pack)[0] ||
    firstText(
      pack.canonical_subject,
      pack.canonical_game,
      pack.game,
      extractGameEntityFromTitle(pack.title),
      pack.title,
    )
  );
}

function entityFromCandidate(candidate = {}, pack = {}, referencePlan = {}) {
  return firstText(
    candidate.entity,
    candidate.canonical_subject,
    candidate.game,
    candidate.title_entity,
  );
}

function sourceUrlFromCandidate(candidate = {}) {
  return firstText(
    candidate.direct_media_url_if_available,
    candidate.directMediaUrlIfAvailable,
    candidate.source_url,
    candidate.sourceUrl,
    candidate.reference_url,
    candidate.referenceUrl,
    candidate.official_source_url,
    candidate.url,
    candidate.href,
    candidate.channel_url,
  );
}

function sourceFamilyFromCandidate(candidate = {}) {
  return normaliseFamily(
    candidate.source_family ||
      candidate.sourceFamily ||
      candidate.source_id ||
      candidate.sourceId ||
      candidate.provider ||
      candidate.display_name,
  );
}

function sourceKindIsSegmentEligible(kind) {
  return ["direct_video", "hls_manifest", "dash_manifest"].includes(cleanText(kind));
}

function segmentValidationEligibleFor(kind) {
  return sourceKindIsSegmentEligible(kind);
}

function sourceKindForUrl(sourceUrl, explicitKindValue = "") {
  const detected = sourceUrl ? mediaSourceUrlKindFields(sourceUrl) : {};
  const explicitKind = cleanText(explicitKindValue);
  const detectedKind = cleanText(detected.source_url_kind);
  if (sourceKindIsSegmentEligible(explicitKind) && detectedKind && !sourceKindIsSegmentEligible(detectedKind)) {
    return detectedKind;
  }
  return firstText(explicitKind, detectedKind);
}

function sourceKindScore(candidate = {}) {
  return sourceKindIsSegmentEligible(candidate.source_url_kind) ? 1 : 0;
}

function candidateKey(candidate = {}) {
  return sourceFamilyFromCandidate(candidate) || sourceUrlFromCandidate(candidate) || cleanText(candidate.display_name);
}

function mergeCandidate(existing = {}, incoming = {}) {
  const preferred = sourceKindScore(incoming) > sourceKindScore(existing) ? incoming : existing;
  const secondary = preferred === existing ? incoming : existing;
  const sourceUrl = firstText(preferred.source_url, secondary.source_url);
  const sourceUrlKind = firstText(preferred.source_url_kind, secondary.source_url_kind);
  const reconciledSourceUrlKind = sourceKindForUrl(sourceUrl, sourceUrlKind);
  const referenceUrl = firstText(
    preferred.reference_url && preferred.reference_url !== sourceUrl ? preferred.reference_url : "",
    secondary.reference_url && secondary.reference_url !== sourceUrl ? secondary.reference_url : "",
    !sourceKindIsSegmentEligible(secondary.source_url_kind) ? secondary.source_url : "",
    !sourceKindIsSegmentEligible(preferred.source_url_kind) ? preferred.source_url : "",
    sourceUrl,
  );
  return {
    ...incoming,
    ...existing,
    source_url: sourceUrl,
    reference_url: referenceUrl,
    source_url_kind: reconciledSourceUrlKind,
    segment_validation_eligible: segmentValidationEligibleFor(reconciledSourceUrlKind),
    status: candidateStatus({
      ...incoming,
      ...existing,
      source_url_kind: reconciledSourceUrlKind,
      segment_validation_eligible: segmentValidationEligibleFor(reconciledSourceUrlKind),
    }),
    display_name: firstText(existing.display_name, incoming.display_name),
    entity: firstText(existing.entity, incoming.entity),
    source_family: firstText(existing.source_family, incoming.source_family),
    source_tier: firstText(existing.source_tier, incoming.source_tier),
    rights_risk_class: firstText(existing.rights_risk_class, incoming.rights_risk_class),
    allowed_render_use: firstText(existing.allowed_render_use, incoming.allowed_render_use),
    source_duration_s: preferred.source_duration_s || secondary.source_duration_s || null,
    entities: Array.from(new Set([...asArray(existing.entities), ...asArray(incoming.entities)])),
  };
}

function planForStory(referenceReport = {}, storyId = "") {
  return asArray(referenceReport.plans).find((plan) => cleanText(plan.story_id) === storyId) || {};
}

function plannedSearchMatchesFallbackEntity(action = {}, fallbackEntity = "") {
  const fallback = cleanText(fallbackEntity);
  if (!fallback) return true;
  if (sourceEntityMatchesStoryEntities(action.entity, [fallback])) return true;
  const query = normaliseMatchText(action.query);
  const fallbackKey = normaliseMatchText(fallback);
  if (query && fallbackKey && query.includes(fallbackKey)) return true;
  const fallbackTokens = fallbackKey.split(" ").filter((token) => token.length > 2);
  return fallbackTokens.length >= 2 && fallbackTokens.every((token) => query.includes(token));
}

const PRODUCT_VISUAL_ENTITIES = new Set([
  "ps5",
  "playstation 5",
  "xbox controller",
  "xbox wireless controller",
  "steam deck",
  "steam controller",
  "nintendo switch",
  "nintendo switch 2",
]);

function storyEntityHasBroadPlatformToken(entity = "") {
  const key = normaliseMatchText(entity);
  if (!key) return false;
  if (storyEntityIsBroadPlatformOrCompany(key)) return true;
  return Array.from(BROAD_PLATFORM_OR_COMPANY_ENTITIES).some(
    (platform) => key === platform || key.startsWith(`${platform} `) || key.endsWith(` ${platform}`),
  );
}

function visualSearchPolicyForEntity(entity = "", pack = {}) {
  const text = cleanText([entity, pack.title, pack.canonical_subject, pack.canonical_angle].join(" "));
  const key = normaliseMatchText(entity);
  if (/\b(?:lawsuit|sues?|legal|court|professor status)\b/i.test(text)) {
    return {
      blockers: ["legal_story_requires_source_card_or_human_visual_plan"],
    };
  }
  if (/\b(?:stake|acquisition|merger|shareholder|investment|bought|buyout)\b/i.test(text)) {
    return {
      blockers: ["corporate_transaction_requires_owned_explainer_visual_plan"],
      accepted_sources: [
        "official company newsroom",
        "official investor relations source",
        "regulatory filing or company statement",
        "reliable non-discovery publication",
      ],
      visual_plan_type: "corporate_transaction_owned_explainer_plan",
      visual_plan_reason:
        "Corporate transaction stories need source cards, owned explainers and approved company or investor material, not game footage.",
    };
  }
  if (
    storyEntityHasBroadPlatformToken(entity) &&
    /\b(?:exclusive|exclusives|feedback|strategy|review|reevaluate|re-evaluate)\b/i.test(text)
  ) {
    return {
      blockers: ["broad_platform_story_requires_specific_visual_plan"],
      visual_plan_type: "broad_platform_owned_explainer_plan",
      visual_plan_reason:
        "Broad platform stories need owned explainers or approved platform-holder media, not unrelated game footage.",
    };
  }
  if (PRODUCT_VISUAL_ENTITIES.has(key) || /\b(?:controller|console|hardware|handheld)\b/i.test(text)) {
    return {
      query_suffix: "official product video",
      accepted_sources: [
        "official platform product page",
        "official platform channel",
        "manufacturer media page",
      ],
      visual_plan_type: "platform_product_visual_plan",
      visual_plan_reason:
        "Hardware and price stories need official product or platform visuals, not gameplay from an unrelated game.",
    };
  }
  if (normaliseMatchText(text).includes("pokemon go")) {
    return {
      query_suffix: "official trailer",
      accepted_sources: ["official publisher channel", "official game site", "platform storefront"],
    };
  }
  return {
    query_suffix: "official gameplay trailer",
    accepted_sources: ["Steam", "official publisher channel", "platform storefront"],
  };
}

const TITLE_ENTITY_REQUIREMENTS = [
  { title: "steam controller", requiredEntity: "steam controller" },
  { title: "steam deck", requiredEntity: "steam deck" },
  { title: "xbox controller", requiredEntity: "xbox controller" },
  { title: "ps5", requiredEntity: "ps5" },
  { title: "playstation 5", requiredEntity: "playstation 5" },
  { title: "pokemon go", requiredEntity: "pokemon go" },
];

function titleSpecificEntityMismatchBlockers(entity = "", pack = {}) {
  const title = normaliseMatchText(pack.title || pack.selected_title || pack.canonical_title);
  const key = normaliseMatchText(entity);
  if (!title || !key) return [];
  return TITLE_ENTITY_REQUIREMENTS.some(
    (requirement) => title.includes(requirement.title) && !key.includes(requirement.requiredEntity),
  )
    ? ["canonical_subject_title_mismatch"]
    : [];
}

function titleRequiredEntity(title = "") {
  const titleText = normaliseMatchText(title);
  const match = TITLE_ENTITY_REQUIREMENTS.find((requirement) =>
    titleText.includes(requirement.title),
  );
  return match ? match.requiredEntity : "";
}

function plannedOfficialSearchActionsFor(referencePlan = {}, fallbackEntity = "") {
  return asArray(referencePlan.planned_searches).map((item) => ({
    query: cleanText(item.query),
    entity: cleanText(item.entity),
    accepted_sources: asArray(item.accepted_sources).map(cleanText).filter(Boolean),
    will_download: item.will_download === true ? true : false,
    status: cleanText(referencePlan.motion_reference_readiness || "official_search_required"),
  })).filter((item) => {
    if (!item.query || !plannedSearchMatchesFallbackEntity(item, fallbackEntity)) return false;
    const policy = visualSearchPolicyForEntity(item.entity, { title: referencePlan.title });
    if (!asArray(policy.blockers).length) return true;
    return !/\b(?:gameplay|trailer|footage|b-roll|broll)\b/i.test(item.query);
  });
}

function officialSearchActionsFor(referencePlan = {}, fallbackEntity = "", pack = {}) {
  const planned = plannedOfficialSearchActionsFor(referencePlan, fallbackEntity);
  if (planned.length) return planned;

  const entity = cleanText(fallbackEntity);
  if (!entity) return [];
  const policy = visualSearchPolicyForEntity(entity, pack);
  if (asArray(policy.blockers).length) return [];
  return [
    {
      query: `${entity} ${policy.query_suffix || "official gameplay trailer"}`,
      entity,
      accepted_sources: asArray(policy.accepted_sources).length
        ? policy.accepted_sources
        : ["Steam", "official publisher channel", "platform storefront"],
      will_download: false,
      status: "official_search_required",
    },
  ];
}

function governedVisualPlanAllowedAssetClasses(planType) {
  if (planType === "platform_product_visual_plan") {
    return [
      "official product video",
      "official platform product page media",
      "manufacturer media page",
      "owned kinetic price/context cards",
      "owned source-proof cards",
    ];
  }
  if (planType === "corporate_transaction_owned_explainer_plan") {
    return [
      "owned company relationship cards",
      "owned timeline graphics",
      "official investor or company source cards",
      "approved logo usage with rights record",
    ];
  }
  if (planType === "legal_source_card_plan") {
    return [
      "owned claim boundary cards",
      "source-card heavy legal context",
      "official court or company source cards",
    ];
  }
  return [
    "owned explainer cards",
    "official source cards",
    "operator-approved direct media",
  ];
}

function governedVisualPlanForEntity({
  storyId = "",
  entity = "",
  pack = {},
  policy = {},
  sourceSearchBlockers = [],
  officialSearchActions = [],
} = {}) {
  let planType = cleanText(policy.visual_plan_type);
  const blockers = asArray(sourceSearchBlockers).map(cleanText).filter(Boolean);
  if (!planType && blockers.includes("corporate_transaction_requires_owned_explainer_visual_plan")) {
    planType = "corporate_transaction_owned_explainer_plan";
  }
  if (!planType && blockers.includes("legal_story_requires_source_card_or_human_visual_plan")) {
    planType = "legal_source_card_plan";
  }
  if (!planType && !asArray(officialSearchActions).length) return null;

  return {
    story_id: cleanText(storyId),
    entity: cleanText(entity || pack.canonical_subject || pack.title),
    plan_type: planType || "official_source_visual_plan",
    status: "operator_approval_required",
    operator_approval_required: true,
    counts_towards_motion_readiness: false,
    render_gate_status: "blocked_until_operator_approved_source_media",
    reason: cleanText(
      policy.visual_plan_reason ||
        "The story needs official, licensed or operator-approved visual sources before it can count towards Visual V4 motion readiness.",
    ),
    allowed_source_classes: asArray(policy.accepted_sources).length
      ? asArray(policy.accepted_sources).map(cleanText).filter(Boolean)
      : [
          "official publisher channel",
          "official platform holder source",
          "licensed source",
          "operator-approved source",
        ],
    allowed_asset_classes: governedVisualPlanAllowedAssetClasses(planType),
    prohibited_asset_classes: [
      "unrelated gameplay footage",
      "random YouTube reupload",
      "fan montage",
      "reaction video",
      "social media repost without rights basis",
      "article screenshot as dominant visual",
    ],
    required_artefacts: [
      "non_discovery_primary_source_intake_report.json",
      "official_or_licensed_direct_media_intake_report.json",
      "rights_record.json",
      "segment_validation_report.json",
      "motion_pack_manifest.json",
    ],
    required_approvals: [
      "operator_confirms_source_matches_story",
      "operator_confirms_rights_basis",
      "operator_confirms_direct_media_or_owned_plan_is_allowed",
    ],
    source_search_blockers: blockers,
    official_search_actions: asArray(officialSearchActions),
    next_step:
      "Provide an official, licensed or operator-approved source entry, then rerun source-family acquisition and motion-pack validation.",
  };
}

const GENERIC_PRIMARY_ENTITY_WORDS = new Set([
  "capturing",
  "gaming",
  "players",
  "fans",
  "story",
  "update",
  "news",
  "rumour",
  "rumor",
  "leak",
]);

function hasMatchingPlannedSearch(referencePlan = {}, entity = "") {
  return plannedOfficialSearchActionsFor(referencePlan, entity).length > 0;
}

function sourceSearchBlockersForPrimaryEntity(entity = "", pack = {}, referencePlan = {}) {
  const text = cleanText(entity);
  const key = normaliseMatchText(text);
  const blockers = [];
  if (!text) blockers.push("missing_primary_entity");
  if (/[,;:]$/.test(text)) blockers.push("malformed_primary_entity");
  if (GENERIC_PRIMARY_ENTITY_WORDS.has(key)) blockers.push("generic_primary_entity");
  if (/^[a-z]+ing$/i.test(text) && !storyEntityIsBroadPlatformOrCompany(text)) {
    blockers.push("generic_gerund_primary_entity");
  }
  blockers.push(...titleSpecificEntityMismatchBlockers(text, pack));
  if (!hasMatchingPlannedSearch(referencePlan, text)) {
    blockers.push(...asArray(visualSearchPolicyForEntity(text, pack).blockers));
  }
  return [...new Set(blockers)];
}

function candidateFromPackQueue(item = {}, pack = {}, referencePlan = {}) {
  const sourceUrl = sourceUrlFromCandidate(item);
  const explicitKind = sourceKindForUrl(sourceUrl, item.source_url_kind);
  return {
    source_id: firstText(item.source_id, item.id),
    display_name: firstText(item.display_name, item.title, item.name),
    entity: entityFromCandidate(item, pack, referencePlan),
    entities: asArray(item.entities),
    source_type: firstText(item.source_type, item.sourceType),
    source_family: sourceFamilyFromCandidate(item),
    source_tier: firstText(item.source_tier, item.tier, "official"),
    source_url: sourceUrl,
    reference_url: firstText(item.reference_url, item.channel_url, sourceUrl),
    source_url_kind: explicitKind,
    segment_validation_eligible: segmentValidationEligibleFor(explicitKind),
    rights_risk_class: firstText(item.rights_risk_class, "official_reference_only"),
    allowed_render_use: firstText(item.allowed_render_use, "reference_only_by_default"),
    evidence_of_officialness: firstText(
      item.evidence_of_officialness,
      item.display_name,
      "Listed by the trusted source pipeline as official/reference-only.",
    ),
    source_duration_s: item.source_duration_s || item.sourceDurationS || item.duration_seconds || null,
    source_origin: "motion_pack_intake_queue",
  };
}

function candidateFromTrustedReport(item = {}, pack = {}, referencePlan = {}) {
  const sourceUrl = sourceUrlFromCandidate(item);
  const explicitKind = sourceKindForUrl(sourceUrl, item.source_url_kind);
  return {
    source_id: firstText(item.source_id, item.id),
    display_name: firstText(item.display_name, item.title, item.name),
    entity: entityFromCandidate(item, pack, referencePlan),
    entities: asArray(item.entities),
    source_type: firstText(item.source_type, item.sourceType),
    source_family: sourceFamilyFromCandidate(item),
    source_tier: firstText(item.source_tier, item.tier, "official"),
    source_url: sourceUrl,
    reference_url: firstText(item.reference_url, item.channel_url, sourceUrl),
    source_url_kind: explicitKind,
    segment_validation_eligible: segmentValidationEligibleFor(explicitKind),
    rights_risk_class: firstText(item.rights_risk_class, "official_reference_only"),
    allowed_render_use: firstText(item.allowed_render_use, "reference_only_by_default"),
    evidence_of_officialness: firstText(
      item.evidence_of_officialness,
      item.display_name,
      "Accepted by trusted footage registry for this story.",
    ),
    source_duration_s: item.source_duration_s || item.sourceDurationS || item.duration_seconds || null,
    source_origin: "trusted_footage_registry",
  };
}

function candidateFromReference(item = {}, pack = {}, referencePlan = {}) {
  const sourceUrl = sourceUrlFromCandidate(item);
  const explicitKind = sourceKindForUrl(sourceUrl, item.source_url_kind);
  return {
    source_id: firstText(item.source_id, item.provider),
    display_name: firstText(item.display_name, item.reference_title, item.title, item.provider),
    entity: entityFromCandidate(item, pack, referencePlan),
    entities: asArray(item.entities),
    source_type: firstText(item.source_type, item.sourceType),
    source_family: sourceFamilyFromCandidate(item),
    source_tier: firstText(item.source_tier, item.provider === "trusted_footage_registry" ? "official" : "storefront"),
    source_url: sourceUrl,
    reference_url: firstText(item.reference_url, item.referenceUrl, item.reference_page_url, item.official_source_url, item.source_url),
    source_url_kind: explicitKind,
    segment_validation_eligible: segmentValidationEligibleFor(explicitKind),
    rights_risk_class: firstText(item.rights_risk_class, "official_reference_only"),
    allowed_render_use: firstText(item.allowed_render_use, "reference_only_by_default"),
    evidence_of_officialness: firstText(
      item.evidence_of_officialness,
      item.provider ? `Reference supplied by ${item.provider}.` : "Reference resolver candidate.",
    ),
    source_duration_s: item.source_duration_s || item.sourceDurationS || item.duration_seconds || null,
    source_origin: "official_trailer_reference_resolver",
  };
}

function candidateStatus(candidate = {}) {
  if (candidate.segment_validation_eligible === true) return "ready_for_frame_plan";
  const kind = cleanText(candidate.source_url_kind);
  if (kind === "direct_video" || kind === "hls_manifest" || kind === "dash_manifest") {
    return "ready_for_frame_plan";
  }
  return "needs_direct_media_url";
}

function candidateNeedsDirectRefresh(candidate = {}) {
  return (
    candidateStatus(candidate) === "needs_direct_media_url" &&
    !sourceKindIsSegmentEligible(candidate.source_url_kind)
  );
}

function sourceTypeForCandidate(candidate = {}) {
  const explicitType = cleanText(candidate.source_type);
  if (explicitType) return explicitType;
  const tier = cleanText(candidate.source_tier);
  if (tier === "trusted_creator_reference") return "trusted_creator_channel_reference";
  if (tier === "licensed_creator") return "licensed_creator_channel_reference";
  const kind = cleanText(candidate.source_url_kind);
  if (kind.startsWith("youtube")) return "official_youtube_channel_url";
  if (kind === "direct_video" || kind === "hls_manifest" || kind === "dash_manifest") {
    return "platform_storefront_video_reference";
  }
  return "official_publisher_or_developer_trailer_page";
}

function acceptanceChecksForCandidate(candidate = {}) {
  if (cleanText(candidate.source_tier) === "trusted_creator_reference") {
    return [
      "Source is a trusted editorial or creator reference, not an official render-safe source.",
      "Entity, game, edition and locale match the story.",
      "Licence, direct media permission or an operator-supplied approved route is required before render use.",
      "Direct media fields contain only .mp4, .webm, .mov, .m3u8 or .mpd links when supplied.",
      "Usage remains reference-only until licensing and segment validation both approve render windows.",
    ];
  }
  return [
    "Source is official, storefront-hosted or controlled by the publisher, developer or platform holder.",
    "Entity, game, edition and locale match the story.",
    "Direct media fields contain only .mp4, .webm, .mov, .m3u8 or .mpd links when supplied.",
    "Usage remains reference-only until segment validation approves render windows.",
  ];
}

function sourceKeyFromUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  const steamTrailer = text.match(/store_trailers\/(\d+)\/(\d+)/i);
  if (steamTrailer) return `steam:${steamTrailer[1]}:${steamTrailer[2]}`;
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function currentSourceKeys(pack = {}) {
  return new Set(
    asArray(pack.clips)
      .flatMap((clip) => [
        sourceKeyFromUrl(clip.source_url),
        sourceKeyFromUrl(clip.path),
        sourceKeyFromUrl(clip.reference_url),
      ])
      .filter(Boolean),
  );
}

function candidateSourceKeys(candidate = {}) {
  return [
    sourceKeyFromUrl(candidate.source_url),
    sourceKeyFromUrl(candidate.reference_url),
    sourceKeyFromUrl(candidate.official_source_url),
  ].filter(Boolean);
}

function currentFamilyNames(pack = {}) {
  return Array.from(
    new Set(
      asArray(pack.clips)
        .map((clip) => normaliseFamily(clip.source_family || clip.sourceFamily))
        .filter(Boolean),
    ),
  );
}

function entityTokenOverlapMatches(targetTokens = [], sourceTokens = []) {
  if (sharedFranchisePrefixOnlyMatches(targetTokens, sourceTokens)) return false;
  const targetSet = new Set(targetTokens);
  const overlapCount = sourceTokens.filter((token) => targetSet.has(token)).length;
  if (!overlapCount) return false;
  const smallerEntityTokenCount = Math.min(targetTokens.length, sourceTokens.length);
  if (smallerEntityTokenCount <= 1) return overlapCount >= 1;
  return overlapCount >= 2 || overlapCount === smallerEntityTokenCount;
}

const FRANCHISE_PARENT_TOKEN_SETS = [
  ["star", "wars"],
];

const FRANCHISE_PARENT_ENTITIES = new Set(["star wars"]);

function tokenSetContainsAll(tokens = [], required = []) {
  const tokenSet = new Set(tokens);
  return required.every((token) => tokenSet.has(token));
}

function sharedFranchisePrefixOnlyMatches(targetTokens = [], sourceTokens = []) {
  return FRANCHISE_PARENT_TOKEN_SETS.some((prefixTokens) => {
    if (!tokenSetContainsAll(targetTokens, prefixTokens)) return false;
    if (!tokenSetContainsAll(sourceTokens, prefixTokens)) return false;
    const prefixSet = new Set(prefixTokens);
    const targetSpecificTokens = targetTokens.filter((token) => !prefixSet.has(token));
    const sourceSpecificTokens = sourceTokens.filter((token) => !prefixSet.has(token));
    if (!targetSpecificTokens.length || !sourceSpecificTokens.length) return false;
    const sourceSpecificSet = new Set(sourceSpecificTokens);
    return !targetSpecificTokens.some((token) => sourceSpecificSet.has(token));
  });
}

function specificCandidateEntities(candidate = {}) {
  const seen = new Set();
  const entities = [];
  for (const entity of [candidate.entity, ...asArray(candidate.entities)]) {
    const text = cleanText(entity);
    const key = normaliseMatchText(text);
    if (!key || seen.has(key)) continue;
    const tokens = key.split(" ").filter((token) => token.length > 1);
    if (tokens.length < 2) continue;
    seen.add(key);
    entities.push(text);
  }
  return entities;
}

const BROAD_PLATFORM_OR_COMPANY_ENTITIES = new Set([
  "xbox",
  "playstation",
  "nintendo",
  "steam",
  "valve",
  "sony",
  "microsoft",
  "ea",
  "electronic arts",
  "ubisoft",
  "sega",
  "capcom",
  "square enix",
  "bethesda",
]);

function storyEntityIsBroadPlatformOrCompany(entity = "") {
  const key = normaliseMatchText(entity);
  return BROAD_PLATFORM_OR_COMPANY_ENTITIES.has(key);
}

function sourceEntityIsParentOnlyForSpecificStory(sourceText = "", storyText = "") {
  if (!sourceText || !storyText || sourceText === storyText) return false;
  if (!storyText.includes(sourceText)) return false;
  return storyEntityIsBroadPlatformOrCompany(sourceText) || FRANCHISE_PARENT_ENTITIES.has(sourceText);
}

function candidateHasSpecificEntityOutsideBroadStory(candidate = {}, storyEntities = []) {
  const broadStoryKeys = storyEntities
    .filter(storyEntityIsBroadPlatformOrCompany)
    .map(normaliseMatchText);
  if (!broadStoryKeys.length) return false;

  return specificCandidateEntities(candidate).some((entity) => {
    const key = normaliseMatchText(entity);
    if (!key || broadStoryKeys.includes(key)) return false;
    return true;
  });
}

function sourceEntityMatchesStoryEntities(sourceEntity, storyEntities = []) {
  const sourceText = normaliseMatchText(sourceEntity);
  if (!sourceText) return false;
  const sourceTokens = sourceText.split(" ").filter((token) => token.length > 1);
  for (const storyEntity of storyEntities) {
    const storyText = normaliseMatchText(storyEntity);
    if (!storyText) continue;
    if (sourceEntityIsParentOnlyForSpecificStory(sourceText, storyText)) continue;
    if (storyText.includes(sourceText) || sourceText.includes(storyText)) return true;
    const storyTokens = storyText.split(" ").filter((token) => token.length > 1);
    if (entityTokenOverlapMatches(storyTokens, sourceTokens)) return true;
  }
  return false;
}

function entityMatchesCandidate(entity, candidate = {}) {
  const target = normaliseMatchText(entity);
  if (!target) return false;
  const targetTokens = target.split(" ").filter((token) => token.length > 1);
  const freeText = candidateFreeText(candidate);
  if (freeText.includes(target)) return true;
  if (targetTokens.length && targetTokens.every((token) => freeText.includes(token))) return true;

  for (const candidateEntity of asArray(candidate.entities)) {
    const sourceEntity = normaliseMatchText(candidateEntity);
    if (!sourceEntity) continue;
    if (sourceEntityIsParentOnlyForSpecificStory(sourceEntity, target)) continue;
    if (sourceEntity.includes(target) || target.includes(sourceEntity)) return true;
    const sourceTokens = sourceEntity.split(" ").filter((token) => token.length > 1);
    if (entityTokenOverlapMatches(targetTokens, sourceTokens)) return true;
  }
  return false;
}

function candidateFreeText(candidate = {}) {
  return normaliseMatchText(
    [
      candidate.entity,
      candidate.display_name,
      candidate.source_family,
      candidate.source_id,
      candidate.source_url,
      candidate.reference_url,
      candidate.evidence_of_officialness,
    ].join(" "),
  );
}

function candidateHasDirectStorySignal(candidate = {}, storyEntities = []) {
  const freeText = candidateFreeText(candidate);
  return storyEntities.some((entity) => {
    const target = normaliseMatchText(entity);
    if (!target) return false;
    const targetTokens = target.split(" ").filter((token) => token.length > 1);
    return freeText.includes(target) || (targetTokens.length && targetTokens.every((token) => freeText.includes(token)));
  });
}

function isGenericParentChannelCandidate(candidate = {}) {
  return cleanText(candidate.source_url_kind).startsWith("youtube_page");
}

function candidateMatchesStory(candidate = {}, storyEntities = []) {
  if (!storyEntities.length) return true;
  if (candidateHasSpecificEntityOutsideBroadStory(candidate, storyEntities)) return false;
  const specificEntities = specificCandidateEntities(candidate);
  if (
    specificEntities.length &&
    !specificEntities.some((entity) => sourceEntityMatchesStoryEntities(entity, storyEntities))
  ) {
    return false;
  }
  return storyEntities.some((entity) => entityMatchesCandidate(entity, candidate));
}

function collectSourceFamilyCandidates({ pack = {}, trustedFootageReport = {}, referenceReport = {} } = {}) {
  const storyId = storyIdFromPack(pack);
  const referencePlan = planForStory(referenceReport, storyId);
  const storyEntities = referencePlanStoryEntities(referencePlan, pack);
  if (!storyEntities.length) {
    const fallbackEntity = primaryEntityForPack(pack, referencePlan);
    if (fallbackEntity) storyEntities.push(fallbackEntity);
  }
  const usedFamilies = new Set(currentFamilyNames(pack));
  const usedSourceKeys = currentSourceKeys(pack);
  const byKey = new Map();

  function add(candidate) {
    const family = normaliseFamily(candidate.source_family);
    const key = family || candidateKey(candidate);
    if (!key) return;
    const normalised = {
      ...candidate,
      source_family: family || key,
      status: candidateStatus(candidate),
    };
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeCandidate(existing, normalised) : normalised);
  }

  for (const item of asArray(pack.trusted_source_pipeline?.intake_queue)) {
    add(candidateFromPackQueue(item, pack, referencePlan));
  }
  for (const item of asArray(trustedFootageReport.story_candidates)) {
    if (cleanText(item.story_id) && cleanText(item.story_id) !== storyId) continue;
    add(candidateFromTrustedReport(item, pack, referencePlan));
  }
  for (const item of asArray(trustedFootageReport.accepted_sources)) {
    const itemStoryId = cleanText(item.story_id);
    if (itemStoryId && itemStoryId !== storyId) continue;
    const candidate = candidateFromTrustedReport(item, pack, referencePlan);
    if (!itemStoryId) {
      if (!storyEntities.length) continue;
      if (!candidateMatchesStory(candidate, storyEntities)) continue;
    }
    add(candidate);
  }
  for (const ref of asArray(referencePlan.references)) {
    add(candidateFromReference(ref, pack, referencePlan));
  }

  const candidates = Array.from(byKey.values())
    .filter(
      (candidate) =>
        !usedFamilies.has(normaliseFamily(candidate.source_family)) ||
        candidateNeedsDirectRefresh(candidate),
    )
    .filter(
      (candidate) =>
        candidateNeedsDirectRefresh(candidate) ||
        !candidateSourceKeys(candidate).some((sourceKey) => usedSourceKeys.has(sourceKey)),
    )
    .filter((candidate) => candidateMatchesStory(candidate, storyEntities));
  const hasSpecificStorySource = candidates.some((candidate) =>
    candidateHasDirectStorySignal(candidate, storyEntities),
  );

  return candidates
    .filter(
      (candidate) =>
        !hasSpecificStorySource ||
        !isGenericParentChannelCandidate(candidate) ||
        candidateHasDirectStorySignal(candidate, storyEntities),
    )
    .sort((a, b) => {
      const statusDelta =
        (a.status === "ready_for_frame_plan" ? 0 : 1) -
        (b.status === "ready_for_frame_plan" ? 0 : 1);
      if (statusDelta) return statusDelta;
      return cleanText(a.source_family).localeCompare(cleanText(b.source_family));
    });
}

function safeNextCommands(
  storyId,
  {
    hasSourceIntake = false,
    hasOfficialSearch = false,
    hasGovernedVisualPlan = false,
    needsCanonicalEntityRepair = false,
    needsRealVisualMediaOrHumanReview = false,
    commandPaths = {},
  } = {},
) {
  const suffix = storyId ? ` --story-id ${storyId}` : "";
  const paths = {
    sourceFamilyIntakeTemplate:
      cleanText(commandPaths.sourceFamilyIntakeTemplate) ||
      "test/output/visual_v4_source_family_intake_template.json",
    officialSearchTemplate:
      cleanText(commandPaths.officialSearchTemplate) ||
      "test/output/visual_v4_official_search_template.json",
    governedVisualPlanTemplate:
      cleanText(commandPaths.governedVisualPlanTemplate) ||
      "test/output/visual_v4_governed_visual_plan_template.json",
    officialDirectMediaIntakeTemplate:
      cleanText(commandPaths.officialDirectMediaIntakeTemplate) ||
      "test/output/official_direct_media_intake_template.json",
    officialDirectMediaDiscoveryJson:
      cleanText(commandPaths.officialDirectMediaDiscoveryJson) ||
      "test/output/official_direct_media_discovery.json",
    officialDirectMediaDiscoveryMd:
      cleanText(commandPaths.officialDirectMediaDiscoveryMd) ||
      "test/output/official_direct_media_discovery.md",
    licensedDirectMediaReport:
      cleanText(commandPaths.licensedDirectMediaReport) ||
      "test/output/studio_v4_licensed_direct_media_acquisition.json",
    trustedFootageRegistryReport:
      cleanText(commandPaths.trustedFootageRegistryReport) ||
      "test/output/trusted_footage_registry_report.json",
    segmentValidationReport:
      cleanText(commandPaths.segmentValidationReport) ||
      "test/output/official_trailer_segment_validation_apply_local.json",
  };
  const framePlanFlags = " --max-references 12 --max-references-per-entity 12 --max-target-frames 48";
  const frameExtractFlags = " --max-frames-per-story 48";
  const segmentValidationFlags =
    " --deep-scan --include-frame-anchored-windows --candidate-windows-per-source 6 --max-segments 72";
  if (needsCanonicalEntityRepair) {
    return [
      {
        step: "repair_canonical_entity",
        command:
          `npm run ops:goal-public-copy-repair --${suffix} --story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract`,
      },
      {
        step: "rerun_source_family_acquisition",
        command:
          `npm run ops:v4-source-family-acquisition --${suffix} --story-packages output/goal-contract/story-packages.json`,
      },
    ];
  }
  const commands = [];
  if (hasSourceIntake) {
    commands.push(
      {
        step: "discover_direct_media_from_official_pages",
        command:
          `npm run media:discover-direct-media -- --input ${paths.sourceFamilyIntakeTemplate}${suffix} --output-json ${paths.officialDirectMediaDiscoveryJson} --output-md ${paths.officialDirectMediaDiscoveryMd} --output-template ${paths.officialDirectMediaIntakeTemplate}`,
      },
      {
        step: "validate_operator_supplied_official_sources",
        command:
          `npm run media:intake-official-sources -- --input ${paths.officialDirectMediaIntakeTemplate}${suffix}`,
      },
    );
  } else if (hasOfficialSearch) {
    commands.push(
      {
        step: "fill_official_source_intake_from_search_template",
        command:
          `manual: use ${paths.officialSearchTemplate} to add official source URLs to ${paths.sourceFamilyIntakeTemplate}${storyId ? ` for ${storyId}` : ""}`,
      },
      {
        step: "validate_operator_supplied_official_sources",
        command:
          `npm run media:intake-official-sources -- --input ${paths.sourceFamilyIntakeTemplate}${suffix}`,
      },
    );
  } else if (needsRealVisualMediaOrHumanReview) {
    return [
      {
        step: "supply_rights_backed_real_visual_media",
        command:
          `manual: add official, storefront, licensed or operator-owned real visual media for ${storyId}; ` +
          "do not approve another generated-only owned explainer deck for this blocker",
      },
      {
        step: "route_to_human_review_or_reject",
        command:
          `manual: route ${storyId} to human review or reject it if no rights-backed real media can be supplied`,
      },
    ];
  } else if (hasGovernedVisualPlan) {
    return [
      {
        step: "approve_governed_visual_plan",
        command:
          `manual: review ${paths.governedVisualPlanTemplate} and add operator-approved source media or owned explainer inputs${storyId ? ` for ${storyId}` : ""}`,
      },
      {
        step: "rerun_source_family_acquisition",
        command:
          `npm run ops:v4-source-family-acquisition --${suffix} --story-packages output/goal-contract/story-packages.json`,
      },
    ];
  }
  commands.push(
    {
      step: "classify_licensed_direct_media_readiness",
      command: `npm run ops:v4-licensed-direct-media --${suffix}`,
    },
    {
      step: "resolve_trailer_references",
      command:
        `npm run media:resolve-trailers --${suffix} --official-source-intake-report ${paths.licensedDirectMediaReport} --trusted-footage-registry-report ${paths.trustedFootageRegistryReport} --segment-validation-report ${paths.segmentValidationReport} --write-latest-report`,
    },
    {
      step: "plan_controlled_frame_windows",
      command: `npm run media:plan-frames --${suffix}${framePlanFlags}`,
    },
    {
      step: "extract_controlled_frames",
      command: `npm run media:extract-frames --${suffix} --apply-local${frameExtractFlags}`,
    },
    {
      step: "validate_motion_segments",
      command: `npm run media:validate-trailer-segments --${suffix} --apply-local${segmentValidationFlags}`,
    },
    {
      step: "rebuild_visual_v4_motion_pack",
      command: `npm run ops:v4-motion-pack --${suffix}`,
    },
  );
  return commands;
}

function buildRow({ pack = {}, trustedFootageReport = {}, referenceReport = {}, commandPaths = {} } = {}) {
  const storyId = storyIdFromPack(pack);
  const directVideoEnrichmentRequested = pack.direct_video_enrichment_requested === true;
  const realVisualMediaRequiredAfterOwnedExplainerFailed =
    pack.real_visual_media_required_after_owned_explainer_failed === true;
  const readinessStatus = cleanText(pack.readiness?.status || "unknown");
  const blockingCurrentMotionReadiness = readinessStatus !== "v4_motion_ready";
  const budget = pack.motion_budget || {};
  const currentFamilies = currentFamilyNames(pack);
  const currentMotionClips = numberOrZero(
    budget.available_motion_clips ?? asArray(pack.clips).length,
  );
  const requiredMotionClips = numberOrZero(budget.required_motion_scenes);
  const currentMotionFamilies = numberOrZero(
    budget.available_distinct_families ?? currentFamilies.length,
  );
  const requiredMotionFamilies = numberOrZero(budget.required_distinct_families);
  const sourceFamilyCandidates = collectSourceFamilyCandidates({
    pack,
    trustedFootageReport,
    referenceReport,
  });
  const referencePlan = planForStory(referenceReport, storyId);
  const primaryStoryEntity = primaryEntityForPack(pack, referencePlan);
  const searchEntity = fallbackSearchEntityForPack(pack, referencePlan) || primaryStoryEntity;
  const visualSearchPolicy = visualSearchPolicyForEntity(searchEntity, pack);
  const sourceSearchBlockers = sourceSearchBlockersForPrimaryEntity(searchEntity, pack, referencePlan);
  const canonicalEntityRepairBlockers = sourceSearchBlockersForPrimaryEntity(
    primaryStoryEntity,
    pack,
    referencePlan,
  ).filter((blocker) => CANONICAL_ENTITY_REPAIR_BLOCKERS.has(cleanText(blocker)));
  const officialSearchActions = sourceFamilyCandidates.length || sourceSearchBlockers.length
    ? []
    : officialSearchActionsFor(
        referencePlan,
        searchEntity,
        pack,
      );
  const governedVisualPlan = realVisualMediaRequiredAfterOwnedExplainerFailed
    ? null
    : governedVisualPlanForEntity({
        storyId,
        entity: searchEntity,
        pack,
        policy: visualSearchPolicy,
        sourceSearchBlockers,
        officialSearchActions,
      });

  return {
    story_id: storyId,
    title: cleanText(pack.title),
    primary_story_entity: primaryStoryEntity,
    source_proof_covered_target_entities: asArray(referencePlan.source_proof_covered_target_entities),
    source_proof_missing_target_entities: asArray(referencePlan.source_proof_missing_target_entities),
    motion_covered_target_entities: asArray(referencePlan.covered_target_entities),
    motion_missing_target_entities: asArray(referencePlan.missing_target_entities),
    readiness_status: readinessStatus,
    blocking_current_motion_readiness: blockingCurrentMotionReadiness,
    direct_video_enrichment_requested: directVideoEnrichmentRequested,
    real_visual_media_required_after_owned_explainer_failed:
      realVisualMediaRequiredAfterOwnedExplainerFailed,
    render_input_dead_end_blocker: pack.render_input_dead_end_blocker === true,
    render_input_operator_required: pack.render_input_operator_required === true,
    render_input_reject_recommended: pack.render_input_reject_recommended === true,
    render_input_statuses: asArray(pack.render_input_statuses).map(cleanText).filter(Boolean),
    render_input_blockers: asArray(pack.render_input_blockers).map(cleanText).filter(Boolean),
    render_input_repair_lanes: asArray(pack.render_input_repair_lanes).map(cleanText).filter(Boolean),
    blockers: [
      ...asArray(pack.readiness?.blockers),
      ...(directVideoEnrichmentRequested
        ? ["visual_evidence:direct_video_motion_missing"]
        : []),
    ],
    current_motion_families: currentMotionFamilies,
    required_motion_families: requiredMotionFamilies,
    missing_motion_families: Math.max(0, requiredMotionFamilies - currentMotionFamilies),
    current_motion_clips: currentMotionClips,
    required_motion_clips: requiredMotionClips,
    missing_motion_clips: Math.max(0, requiredMotionClips - currentMotionClips),
    missing_direct_video_motion: directVideoEnrichmentRequested ? 1 : 0,
    current_family_names: currentFamilies,
    source_family_candidates: sourceFamilyCandidates,
    official_search_actions: officialSearchActions,
    source_search_blockers: sourceSearchBlockers,
    canonical_entity_repair_blockers: canonicalEntityRepairBlockers,
    governed_visual_plan: governedVisualPlan,
    intake_needed_count: sourceFamilyCandidates.filter(
      (candidate) => candidate.status === "needs_direct_media_url",
    ).length,
    safe_next_commands: safeNextCommands(storyId, {
      hasSourceIntake: sourceFamilyCandidates.length > 0,
      hasOfficialSearch: officialSearchActions.length > 0,
      hasGovernedVisualPlan: Boolean(governedVisualPlan),
      needsCanonicalEntityRepair: canonicalEntityRepairBlockers.length > 0,
      needsRealVisualMediaOrHumanReview: realVisualMediaRequiredAfterOwnedExplainerFailed,
      commandPaths,
    }),
  };
}

function buildSourceFamilyIntakeTemplate(rows = []) {
  const entries = [];
  for (const row of asArray(rows)) {
    for (const candidate of asArray(row.source_family_candidates)) {
      const hasDirectMedia = sourceKindIsSegmentEligible(candidate.source_url_kind) && cleanText(candidate.source_url);
      if (candidate.status !== "needs_direct_media_url" && !hasDirectMedia) continue;
      const entity = cleanText(row.primary_story_entity || candidate.entity || row.title);
      const entry = {
        story_id: row.story_id,
        entity,
        source_family: cleanText(candidate.source_family),
        source_type: sourceTypeForCandidate(candidate),
        source_owner: cleanText(candidate.display_name || candidate.source_id || candidate.source_family),
        official_source_url: cleanText(hasDirectMedia ? candidate.reference_url || candidate.source_url : candidate.reference_url || candidate.source_url),
        direct_media_url_if_available: hasDirectMedia ? cleanText(candidate.source_url) : "",
        approved_direct_media_url: "",
        local_operator_file_path: "",
        licence_evidence: "",
        permission_evidence: "",
        licence_scope: "",
        licence_expires_at: "",
        autonomous_use_approved: false,
        approval_notes: "",
        direct_media_url_notes:
          "Paste only an official direct video URL if available, such as a .mp4, .webm, .mov, .m3u8 or .mpd URL. Leave blank if the source is only a page or YouTube watch link.",
        evidence_of_officialness: cleanText(candidate.evidence_of_officialness),
        entity_match_notes: `Must visibly match ${entity} and the story ${row.story_id}.`,
        downloads_allowed: false,
        acceptance_checks: acceptanceChecksForCandidate(candidate),
        rejection_checks: [
          "random_youtube_reupload",
          "social_media_repost",
          "youtube_compilation",
          "reaction_video",
          "localised_non_english_reference",
          "embedded_subtitle_reference",
          "direct_media_field_contains_page_url",
        ],
      };
      if (candidate.source_duration_s) entry.source_duration_s = candidate.source_duration_s;
      entries.push(entry);
    }
  }
  return entries;
}

function buildOfficialSearchTemplate(rows = []) {
  const entries = [];
  for (const row of asArray(rows)) {
    for (const action of asArray(row.official_search_actions)) {
      entries.push({
        story_id: row.story_id,
        entity: cleanText(action.entity || row.primary_story_entity || row.title),
        query: cleanText(action.query),
        accepted_sources: asArray(action.accepted_sources).map(cleanText).filter(Boolean),
        will_download: action.will_download === true,
        status: cleanText(action.status || "official_search_required"),
        downloads_allowed: false,
        candidate_generation_policy: "search_action_only_not_render_candidate",
        next_step:
          "Find an official, storefront, publisher or platform-holder page, then rerun trusted footage/direct media intake.",
      });
    }
  }
  return entries.filter((entry) => entry.query);
}

function buildGovernedVisualPlanTemplate(rows = []) {
  return asArray(rows)
    .map((row) => row.governed_visual_plan)
    .filter((entry) => entry && typeof entry === "object");
}

const CANONICAL_ENTITY_REPAIR_BLOCKERS = new Set([
  "missing_primary_entity",
  "malformed_primary_entity",
  "generic_primary_entity",
  "generic_gerund_primary_entity",
  "canonical_subject_title_mismatch",
]);

function canonicalEntityRepairCandidate(row = {}) {
  return firstText(
    knownGameAliasFromText(row.title),
    titleRequiredEntity(row.title),
    extractGameEntityFromTitle(row.title),
  );
}

function canonicalEntityRepairPlanForRow(row = {}) {
  const blockers = Array.from(
    new Set(
      [
        ...asArray(row.canonical_entity_repair_blockers),
        ...asArray(row.source_search_blockers).filter((blocker) =>
          CANONICAL_ENTITY_REPAIR_BLOCKERS.has(cleanText(blocker)),
        ),
      ].map(cleanText).filter(Boolean),
    ),
  );
  if (!blockers.length) return null;
  const storyId = cleanText(row.story_id);
  const suggestedEntity = canonicalEntityRepairCandidate(row);
  return {
    story_id: storyId,
    title: cleanText(row.title),
    repair_lane: "canonical_entity_repair",
    operator_approval_required: true,
    current_primary_entity: cleanText(row.primary_story_entity),
    suggested_repaired_entity: suggestedEntity,
    blockers,
    required_manifest_fields: [
      "canonical_subject",
      "canonical_game",
      "selected_title",
      "thumbnail_headline",
      "first_spoken_line",
      "narration_script",
      "source_manifest",
    ],
    recommended_commands: [
      {
        step: "repair_public_copy_and_manifest_entity",
        command:
          `npm run ops:goal-public-copy-repair -- --story-id ${storyId} ` +
          "--story-packages output/goal-contract/story-packages.json --out-dir output/goal-contract",
      },
      {
        step: "rerun_source_family_acquisition",
        command:
          `npm run ops:v4-source-family-acquisition -- --story-id ${storyId} ` +
          "--work-order output/goal-contract/direct_video_enrichment_work_order.json " +
          "--story-packages output/goal-contract/story-packages.json",
      },
    ],
    acceptance_checks: [
      "canonical subject names the game, platform, company or actual subject without scraped-source noise",
      "title, thumbnail, first spoken line and source labels still describe the same story",
      "source-family acquisition no longer reports malformed or generic primary entity",
    ],
  };
}

function buildCanonicalEntityRepairTemplate(rows = []) {
  return asArray(rows)
    .map(canonicalEntityRepairPlanForRow)
    .filter((entry) => entry && typeof entry === "object");
}

function rowHasAcquisitionRunway(row = {}) {
  if (row.render_input_dead_end_blocker === true) return false;
  return (
    asArray(row.source_family_candidates).length > 0 ||
    asArray(row.official_search_actions).length > 0 ||
    Boolean(row.governed_visual_plan) ||
    Boolean(canonicalEntityRepairPlanForRow(row)) ||
    row.real_visual_media_required_after_owned_explainer_failed === true
  );
}

function rowRequiresOperatorAction(row = {}) {
  return row.render_input_operator_required === true ||
    row.governed_visual_plan?.operator_approval_required === true ||
    row.real_visual_media_required_after_owned_explainer_failed === true;
}

function buildAcquisitionRunway(
  rows = [],
  sourceEntries = [],
  searchEntries = [],
  governedPlanEntries = [],
  canonicalEntityRepairEntries = [],
) {
  const blockedRows = asArray(rows);
  const realVisualDecisionRows = blockedRows.filter(
    (row) => row.real_visual_media_required_after_owned_explainer_failed === true,
  );
  const deadEndRows = blockedRows.filter((row) => row.render_input_dead_end_blocker === true);
  const operatorRequiredRows = blockedRows.filter(rowRequiresOperatorAction);
  const rejectRecommendedRows = blockedRows.filter((row) => row.render_input_reject_recommended === true);
  function withWorkOrderCounts(runway = {}) {
    return {
      ...runway,
      dead_end_blocker_rows: deadEndRows.length,
      operator_required_rows: operatorRequiredRows.length,
      reject_recommended_rows: rejectRecommendedRows.length,
    };
  }
  if (!blockedRows.length) {
    return withWorkOrderCounts({
      status: "v4_ready_no_action",
      next_action: "No blocked Visual V4 source-family packs need acquisition.",
      source_intake_rows: 0,
      official_search_rows: 0,
      governed_visual_plan_rows: 0,
    });
  }
  if (asArray(sourceEntries).length > 0) {
    return withWorkOrderCounts({
      status: "source_family_intake_available",
      next_action: "Fill direct media or licence evidence for the source-family intake rows, then rerun V4 motion validation.",
      source_intake_rows: asArray(sourceEntries).length,
      official_search_rows: asArray(searchEntries).length,
      governed_visual_plan_rows: asArray(governedPlanEntries).length,
    });
  }
  if (asArray(searchEntries).length > 0) {
    return withWorkOrderCounts({
      status: "official_search_required",
      next_action: "Run the official search template to find new source families before any render can claim Visual V4.",
      source_intake_rows: 0,
      official_search_rows: asArray(searchEntries).length,
      governed_visual_plan_rows: asArray(governedPlanEntries).length,
    });
  }
  if (asArray(governedPlanEntries).length > 0) {
    return withWorkOrderCounts({
      status: "governed_visual_plan_available",
      next_action:
        "Use the governed visual plan to collect operator-approved source media or owned explainer inputs before render readiness can be claimed.",
      source_intake_rows: 0,
      official_search_rows: 0,
      governed_visual_plan_rows: asArray(governedPlanEntries).length,
      canonical_entity_repair_rows: asArray(canonicalEntityRepairEntries).length,
    });
  }
  if (realVisualDecisionRows.length > 0) {
    return withWorkOrderCounts({
      status: "real_visual_media_or_human_review_required",
      next_action:
        "Supply rights-backed real visual media for rows whose owned explainer decks already failed benchmark, or route those stories to human review/rejection.",
      source_intake_rows: 0,
      official_search_rows: 0,
      governed_visual_plan_rows: 0,
      canonical_entity_repair_rows: asArray(canonicalEntityRepairEntries).length,
      real_visual_or_human_review_rows: realVisualDecisionRows.length,
    });
  }
  if (asArray(canonicalEntityRepairEntries).length > 0) {
    return withWorkOrderCounts({
      status: "canonical_entity_repair_required",
      next_action:
        "Repair malformed or generic canonical entities before source-family acquisition can safely search official media.",
      source_intake_rows: 0,
      official_search_rows: 0,
      governed_visual_plan_rows: 0,
      canonical_entity_repair_rows: asArray(canonicalEntityRepairEntries).length,
    });
  }
  return withWorkOrderCounts({
    status: "entity_or_reference_plan_needed",
    next_action: "Add a canonical entity or reference plan so source-family acquisition can search official media without guessing.",
    source_intake_rows: 0,
    official_search_rows: 0,
    governed_visual_plan_rows: 0,
    canonical_entity_repair_rows: asArray(canonicalEntityRepairEntries).length,
  });
}

function buildStudioV4SourceFamilyAcquisitionReport({
  motionPackReports = [],
  trustedFootageReport = {},
  referenceReport = {},
  directVideoEnrichmentWorkOrder = {},
  commandPaths = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const packs = markDirectVideoEnrichmentRequests(
    motionPackReports,
    directVideoEnrichmentWorkOrder,
  );
  const rows = packs
    .filter(
      (pack) =>
        cleanText(pack.readiness?.status) !== "v4_motion_ready" ||
        pack.direct_video_enrichment_requested === true,
    )
    .map((pack) => buildRow({ pack, trustedFootageReport, referenceReport, commandPaths }))
    .filter(
      (row) =>
        row.missing_motion_families > 0 ||
        row.missing_motion_clips > 0 ||
        row.direct_video_enrichment_requested === true,
    );
  const templateEntries = buildSourceFamilyIntakeTemplate(rows);
  const searchEntries = buildOfficialSearchTemplate(rows);
  const governedPlanEntries = buildGovernedVisualPlanTemplate(rows);
  const canonicalEntityRepairEntries = buildCanonicalEntityRepairTemplate(rows);
  const deadEndRows = rows.filter((row) => row.render_input_dead_end_blocker === true);
  const operatorRequiredRows = rows.filter(rowRequiresOperatorAction);
  const rejectRecommendedRows = rows.filter((row) => row.render_input_reject_recommended === true);
  const noDeadEndBlockers = !deadEndRows.length && rows.every(rowHasAcquisitionRunway);
  const blockingRows = rows.filter((row) => row.blocking_current_motion_readiness !== false);
  const directVideoEnrichmentRows = rows.filter(
    (row) => row.direct_video_enrichment_requested === true,
  );

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "studio_v4_source_family_acquisition",
    local_only: true,
    summary: {
      motion_packs_read: packs.length,
      stories_needing_acquisition: rows.length,
      stories_blocked: blockingRows.length,
      direct_video_enrichment_stories: directVideoEnrichmentRows.length,
      missing_motion_families: rows.reduce((sum, row) => sum + row.missing_motion_families, 0),
      missing_motion_clips: rows.reduce((sum, row) => sum + row.missing_motion_clips, 0),
      missing_direct_video_motion: rows.reduce(
        (sum, row) => sum + Number(row.missing_direct_video_motion || 0),
        0,
      ),
      source_proof_covered_story_count: rows.filter(
        (row) => asArray(row.source_proof_covered_target_entities).length > 0,
      ).length,
      source_proof_missing_story_count: rows.filter(
        (row) => asArray(row.source_proof_missing_target_entities).length > 0,
      ).length,
      source_family_candidates: rows.reduce(
        (sum, row) => sum + asArray(row.source_family_candidates).length,
        0,
      ),
      source_intake_template_entries: templateEntries.length,
      official_search_actions: rows.reduce(
        (sum, row) => sum + asArray(row.official_search_actions).length,
        0,
      ),
      official_search_template_entries: searchEntries.length,
      governed_visual_plan_entries: governedPlanEntries.length,
      canonical_entity_repair_entries: canonicalEntityRepairEntries.length,
      real_visual_or_human_review_entries: rows.filter(
        (row) => row.real_visual_media_required_after_owned_explainer_failed === true,
      ).length,
      dead_end_blocker_entries: deadEndRows.length,
      operator_required_entries: operatorRequiredRows.length,
      reject_recommended_entries: rejectRecommendedRows.length,
    },
    no_dead_end_blockers: noDeadEndBlockers,
    acquisition_runway: buildAcquisitionRunway(
      rows,
      templateEntries,
      searchEntries,
      governedPlanEntries,
      canonicalEntityRepairEntries,
    ),
    safety: {
      local_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
    },
    rows,
    source_intake_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: templateEntries,
    },
    official_search_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: searchEntries,
    },
    governed_visual_plan_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: governedPlanEntries,
    },
    canonical_entity_repair_template: {
      schema_version: 1,
      generated_at: generatedAt,
      entries: canonicalEntityRepairEntries,
    },
  };
}

function renderStudioV4SourceFamilyAcquisitionMarkdown(report = {}) {
  const lines = [];
  lines.push("# Visual V4 Source-Family Acquisition");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push(`Blocked stories: ${report.summary?.stories_blocked ?? 0}`);
  lines.push(`Stories needing acquisition: ${report.summary?.stories_needing_acquisition ?? report.summary?.stories_blocked ?? 0}`);
  lines.push(`Direct-video enrichment stories: ${report.summary?.direct_video_enrichment_stories ?? 0}`);
  lines.push(`Intake template entries: ${report.summary?.source_intake_template_entries ?? 0}`);
  lines.push(`Official search entries: ${report.summary?.official_search_template_entries ?? 0}`);
  lines.push(`Governed visual plan entries: ${report.summary?.governed_visual_plan_entries ?? 0}`);
  lines.push(`Canonical entity repair entries: ${report.summary?.canonical_entity_repair_entries ?? 0}`);
  lines.push(`Real-media or human-review entries: ${report.summary?.real_visual_or_human_review_entries ?? 0}`);
  lines.push(`Dead-end blocker entries: ${report.summary?.dead_end_blocker_entries ?? 0}`);
  lines.push(`Operator-required entries: ${report.summary?.operator_required_entries ?? 0}`);
  lines.push(`Reject-recommended entries: ${report.summary?.reject_recommended_entries ?? 0}`);
  lines.push(`No-dead-end blockers: ${report.no_dead_end_blockers ? "yes" : "no"}`);
  lines.push(`Runway: ${report.acquisition_runway?.status || "unknown"}`);
  lines.push("");
  lines.push("Safety: No downloads, DB mutation, OAuth or posting. This only writes local reports and intake templates.");
  lines.push("");
  lines.push("| story | families | clips | intake rows | top candidates |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const row of asArray(report.rows)) {
    const topCandidates = asArray(row.source_family_candidates)
      .slice(0, 4)
      .map((candidate) => `${candidate.source_family}:${candidate.status}`)
      .join("<br>");
    lines.push(
      `| ${row.story_id || "unknown"} | ${row.current_motion_families}/${row.required_motion_families} | ${row.current_motion_clips}/${row.required_motion_clips} | ${row.intake_needed_count} | ${topCandidates || "none"} |`,
    );
  }
  if (!asArray(report.rows).length) {
    lines.push("| none | 0/0 | 0/0 | 0 | no blocked V4 motion packs |");
  }
  lines.push("");
  lines.push("## Safe Next Commands");
  lines.push("");
  const rows = asArray(report.rows);
  if (rows.length) {
    for (const row of rows) {
      const commands = asArray(row.safe_next_commands).slice(0, 2);
      for (const item of commands) {
        lines.push(`- ${row.story_id || "unknown"} ${item.step}: \`${item.command}\``);
      }
    }
  } else {
    lines.push("- No action needed; current packs are V4 motion-ready.");
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  buildStudioV4SourceFamilyAcquisitionReport,
  buildSourceFamilyIntakeTemplate,
  buildOfficialSearchTemplate,
  buildGovernedVisualPlanTemplate,
  renderStudioV4SourceFamilyAcquisitionMarkdown,
};
