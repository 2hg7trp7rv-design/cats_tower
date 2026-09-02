#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const evidenceDirectory = path.join(root, 'semantic-evidence');
const rawPath = path.join(evidenceDirectory, 'browser-raw.json');
const staticPath = path.join(evidenceDirectory, 'static-report.json');
const reportPath = path.join(evidenceDirectory, 'browser-report.json');
const revisionDirectory = path.join(evidenceDirectory, 'revision');
const baselineRawPath = path.join(revisionDirectory, 'browser-before-raw.json');
const revisionComparisonPath = path.join(revisionDirectory, 'revision-comparison.json');
const revisionControlPath = path.join(root, 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-036.json');
const revisionStages = [
  { lockRound: '007', evidenceRound: '002', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-007', priorCriticRound: '001' },
  { lockRound: '009', evidenceRound: '003', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-009', priorCriticRound: '002' },
  { lockRound: '011', evidenceRound: '004', lockArtifactId: 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-011', priorCriticRound: '003' }
].map((stage) => ({
  ...stage,
  lockPath: path.join(root, `quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-${stage.lockRound}.json`),
  priorCriticPath: path.join(root, `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-independent-critic-round-${stage.priorCriticRound}.json`)
}));
const repository = '2hg7trp7rv-design/cats_tower';
const branch = 'kimi';
const baseUrl = 'http://127.0.0.1:4173/step4/s02/golden-master-p1/';
const failures = [];
const revisionStagePresence = revisionStages.map((stage) => fs.existsSync(stage.lockPath));
const activeRevisionIndex = revisionStagePresence.lastIndexOf(true);
invariant(activeRevisionIndex < 0 || revisionStagePresence.slice(0, activeRevisionIndex + 1).every(Boolean), 'S02 revision decision-lock lineage is non-contiguous');
const revisionMode = activeRevisionIndex >= 0;
invariant(!revisionMode || fs.existsSync(revisionControlPath), 'S02 revision lock exists without the active revision change-control addendum');
const activeRevisionStage = revisionMode ? revisionStages[activeRevisionIndex] : null;

const expectedScenarios = [
  { id: 'GM01', gm: 'GM01', state: 'normal', label: '390x844', width: 390, height: 844, search: '?gm=GM01' },
  { id: 'GM02', gm: 'GM02', state: 'normal', label: '320x667', width: 320, height: 667, search: '?gm=GM02' },
  { id: 'GM03', gm: 'GM03', state: 'normal', label: '375x667', width: 375, height: 667, search: '?gm=GM03' },
  { id: 'GM04', gm: 'GM04', state: 'normal', label: '320x568', width: 320, height: 568, search: '?gm=GM04' },
  { id: 'GM05', gm: 'GM05', state: 'normal', label: '430x932', width: 430, height: 932, search: '?gm=GM05' },
  { id: 'GM06', gm: 'GM06', state: 'reward', label: '390x844', width: 390, height: 844, search: '?gm=GM06' },
  { id: 'GM07', gm: 'GM07', state: 'offline', label: '390x844', width: 390, height: 844, search: '?gm=GM07' },
  { id: 'GM08', gm: 'GM08', state: 'roster', label: '390x844', width: 390, height: 844, search: '?gm=GM08' },
  { id: 'RV360', gm: 'GM01', state: 'normal', label: '360x800', width: 360, height: 800, search: '?gm=GM01&rv=360x800', responsiveOverride: '360x800' },
  { id: 'RV412', gm: 'GM01', state: 'normal', label: '412x915', width: 412, height: 915, search: '?gm=GM01&rv=412x915', responsiveOverride: '412x915' },
  { id: 'SAFE390', gm: 'GM01', state: 'normal', label: '390x844-safe-area', width: 390, height: 844, search: '?gm=GM01' },
  { id: 'TEXT200', gm: 'GM04', state: 'normal', label: '320x568-text-200', width: 320, height: 568, search: '?gm=GM04' },
  { id: 'GM07C320', gm: 'GM07', state: 'offline', label: '320x568-offline-compact', width: 320, height: 568, search: '?gm=GM07&rv=320x568', responsiveOverride: '320x568' },
  { id: 'GM07C320TEXT200', gm: 'GM07', state: 'offline', label: '320x568-offline-compact-text-200-safe-area', width: 320, height: 568, search: '?gm=GM07&rv=320x568', responsiveOverride: '320x568' },
  { id: 'TEXT200SAFE', gm: 'GM04', state: 'normal', label: '320x568-text-200-safe-area', width: 320, height: 568, search: '?gm=GM04' }
];
const expectedOfflineViewStates = ['NO_PROGRESS', 'ELAPSED_UNKNOWN', 'RECONCILING_INDETERMINATE', 'RECONCILING_DETERMINATE', 'PROVISIONAL', 'CONFIRMING', 'CONFIRMED', 'REJECTED', 'RETRYABLE_ERROR', 'UNKNOWN'];

const criteria = {
  VISIBLE_CAT_ALPHA_HEIGHT_MIN_60: ['GTE', 60, 'css-px'],
  VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80: ['GTE', 80, 'css-px'],
  STANDARD_CAT_ALPHA_HEIGHT_MIN_68: ['GTE', 68, 'css-px'],
  STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96: ['GTE', 96, 'css-px'],
  TRANSPARENT_WRAPPER_EXCLUDED: ['EQUALS', true, 'boolean'],
  NON_UNIFORM_CHARACTER_SCALE_ABSENT: ['LTE', 0.01, 'ratio-delta'],
  FOOT_AND_HIT_ANCHORS_BOUND: ['EQUALS', true, 'boolean'],
  DEFEAT_POSE_VISUALLY_DISTINCT: ['EQUALS', true, 'boolean'],
  MEANINGFUL_TEXT_MIN_14: ['GTE', 14, 'css-px'],
  METADATA_TEXT_MIN_12: ['GTE', 12, 'css-px'],
  PRIMARY_LABEL_MIN_14: ['GTE', 14, 'css-px'],
  PRIMARY_CONTROL_HIT_AREA_MIN_48: ['GTE', 48, 'css-px'],
  IMPORTANT_CONTROL_HIT_AREA_MIN_44: ['GTE', 44, 'css-px'],
  CONTROL_HIT_BOUNDS_NONOVERLAP: ['EQUALS', true, 'boolean'],
  CONTROL_HIT_BOUNDS_MIN_GAP_8: ['GTE', 8, 'css-px'],
  MEANINGFUL_TEXT_CONTRAST_WCAG: ['EQUALS', true, 'boolean'],
  STATE_SEMANTICS_NOT_COLOR_ONLY: ['EQUALS', true, 'boolean'],
  DESIGN_TOKEN_DRIFT_ZERO: ['EQUALS', 0, 'count'],
  SEVEN_REQUIRED_VIEWPORTS_PASS: ['EQUALS', 7, 'count'],
  NONZERO_SAFE_AREA_PASS: ['EQUALS', true, 'boolean'],
  TEXT_200_PERCENT_NO_LOSS: ['EQUALS', true, 'boolean'],
  LAYOUT_AND_VISUAL_VIEWPORT_MATCH: ['EQUALS', true, 'boolean'],
  INITIAL_SCROLL_ORIGIN_ZERO: ['EQUALS', true, 'boolean'],
  UNIFORM_FULL_SCREEN_SCALE_ABSENT: ['EQUALS', true, 'boolean'],
  REDUCED_MOTION_POLICY_NATIVE: ['EQUALS', true, 'boolean'],
  REVIEW_BROWSER_MODES_OPERABLE: ['EQUALS', true, 'boolean'],
  GM05_UI_ANTI_BLOAT: ['EQUALS', true, 'boolean'],
  RESPONSIVE_GEOMETRY_CONTRACT: ['EQUALS', true, 'boolean'],
  GM04_REFLOW_OR_SCROLL_PASS: ['EQUALS', true, 'boolean'],
  UNBOUND_RUBY_REMOVED: ['EQUALS', true, 'boolean'],
  UNBOUND_RANK_REMOVED_OR_BOUND: ['EQUALS', true, 'boolean'],
  KILL_COUNTER_AND_OBJECTIVE_CONSISTENT: ['EQUALS', true, 'boolean'],
  REWARD_PROVISIONAL_NOT_CONFIRMED: ['EQUALS', true, 'boolean'],
  ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE: ['EQUALS', true, 'boolean'],
  SUPPORT_NEXT_BATTLE_CAUSALITY_VISIBLE: ['EQUALS', true, 'boolean'],
  GM04_SUPPORT_REMAINS_AVAILABLE: ['EQUALS', true, 'boolean'],
  OFFLINE_RECONCILIATION_ACCESSIBLE: ['EQUALS', true, 'boolean'],
  PARTY_STATE_LABELS_CANONICAL: ['EQUALS', true, 'boolean'],
  REVIEW_COPY_EXCLUDED_FROM_GAME_UI: ['EQUALS', true, 'boolean'],
  EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES: ['EQUALS', true, 'boolean'],
  ANIMATION_ANCHORS_COMPLETE: ['EQUALS', true, 'boolean'],
  NINE_SLICE_CAPS_AND_MINIMUMS_VALID: ['EQUALS', true, 'boolean'],
  PRIMARY_SOURCE_COMPETITORS_6_TO_10: ['BETWEEN', [6, 10], 'count'],
  OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED: ['EQUALS', true, 'boolean'],
  ALL_TEN_FINDING_GROUPS_AUTOMATED: ['EQUALS', 10, 'count']
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), label + ': object required');
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), label + ': exact key set mismatch');
}

function finite(value, minimum = -100000, maximum = 100000) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function safeString(value, maximum) {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

function canonicalSha256(value) {
  return 'sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safelyScopedSelector(selector) {
  if (typeof selector !== 'string' || selector.length > 240 || selector !== selector.trim() || !selector.startsWith(':scope') || /[,~+]|:has\s*\(|[\r\n]/.test(selector)) return false;
  const atom = String.raw`(?:\*|[a-zA-Z][a-zA-Z0-9_-]*|[.#][a-zA-Z_][a-zA-Z0-9_-]*|\[(?:data-[a-z0-9-]+|aria-[a-z0-9-]+|role|id|class)(?:=(?:"[a-zA-Z0-9_.:/-]{1,120}"|'[a-zA-Z0-9_.:/-]{1,120}'|[a-zA-Z_][a-zA-Z0-9_-]*))?\])`;
  const compound = `(?:${atom})+`;
  return new RegExp(`^:scope(?:\\s+|\\s*>\\s*)${compound}(?:(?:\\s+|\\s*>\\s*)${compound})*$`).test(selector);
}
for (const selector of [':scope .item', ':scope > [data-gm="GM01"] .label', ":scope article.party-card[data-party-state='field']"]) invariant(safelyScopedSelector(selector), 'trusted scoped-selector grammar rejected a valid safety vector');
for (const selector of [':scope [', ':scope >> .a', ':scope > > .a', ':scope [id=foo.bar]', ':scope [id="foo\\"]', 'body .a', ':scope .a,.b', ':scope:has(.a)']) invariant(!safelyScopedSelector(selector), 'trusted scoped-selector grammar accepted an invalid safety vector');

function readBounded(target, maximum) {
  const bytes = fs.readFileSync(target);
  invariant(bytes.length > 0 && bytes.length <= maximum, path.relative(root, target) + ': file size outside reviewed cap');
  return bytes;
}

function parseJson(target, maximum) {
  return JSON.parse(readBounded(target, maximum).toString('utf8'));
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }).trim();
}

function validateRect(value, label, nullable = false) {
  if (nullable && value === null) return;
  exactKeys(value, ['left', 'top', 'right', 'bottom', 'width', 'height'], label);
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) invariant(finite(value[key]), label + ': invalid ' + key);
  invariant(value.width >= 0 && value.height >= 0, label + ': negative size');
}

function validateScroll(value, label) {
  exactKeys(value, ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight'], label);
  for (const key of Object.keys(value)) invariant(Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 100000, label + ': invalid ' + key);
}

function validateBox(value, label) {
  exactKeys(value, ['visible', 'rect', 'scroll'], label);
  invariant(typeof value.visible === 'boolean', label + ': visible must be boolean');
  validateRect(value.rect, label + '.rect', true);
  validateScroll(value.scroll, label + '.scroll');
}

function validateDensityMetric(value, label, nullable = false) {
  if (nullable && value === null) return;
  exactKeys(value, ['fontSize', 'rect'], label);
  invariant(finite(value.fontSize, 1, 256), label + ': font size invalid');
  validateRect(value.rect, label + '.rect');
}

function validateStyleBox(value, label, nullable = false) {
  if (nullable && value === null) return;
  exactKeys(value, ['rect', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'], label);
  validateRect(value.rect, label + '.rect');
  for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) invariant(finite(value[key], 0, 500), label + ': invalid ' + key);
}

function validateText(value, label) {
  exactKeys(value, ['text', 'tagName', 'role', 'className', 'textRole', 'transient', 'interactiveAncestor', 'disabledAncestor', 'effectiveOpacity', 'fontSize', 'fontWeight', 'lineHeight', 'rect', 'scroll', 'visible', 'foregroundColor', 'backgroundColor', 'backdropOpaque', 'backdropImageFree', 'contrastRatio'], label);
  invariant(safeString(value.text, 240) && safeString(value.tagName, 40) && safeString(value.role, 80) && safeString(value.className, 240) && safeString(value.textRole, 80) && safeString(value.foregroundColor, 120) && safeString(value.backgroundColor, 120), label + ': text metadata invalid');
  invariant(typeof value.transient === 'boolean' && typeof value.interactiveAncestor === 'boolean' && typeof value.disabledAncestor === 'boolean' && typeof value.backdropOpaque === 'boolean' && typeof value.backdropImageFree === 'boolean', label + ': text semantics invalid');
  invariant(finite(value.effectiveOpacity, 0, 1) && finite(value.fontSize, 0, 256) && finite(value.fontWeight, 1, 1000) && (value.lineHeight === null || finite(value.lineHeight, 0, 512)) && (value.contrastRatio === null || finite(value.contrastRatio, 1, 21)), label + ': opacity/font/contrast metric invalid');
  validateRect(value.rect, label + '.rect', true);
  validateScroll(value.scroll, label + '.scroll');
  invariant(typeof value.visible === 'boolean', label + ': visible invalid');
}

function validateControl(value, label) {
  exactKeys(value, ['tagName', 'role', 'label', 'href', 'tabIndex', 'disabled', 'importance', 'fontSize', 'lineHeight', 'rect', 'scroll', 'visible'], label);
  invariant([value.tagName, value.role, value.label, value.href, value.importance].every((entry) => safeString(entry, entry === value.label ? 240 : 2048)), label + ': control string invalid');
  invariant(Number.isSafeInteger(value.tabIndex) && value.tabIndex >= -1 && value.tabIndex <= 32767, label + ': tabIndex invalid');
  invariant(typeof value.disabled === 'boolean' && typeof value.visible === 'boolean' && ['primary', 'important'].includes(value.importance), label + ': control semantics invalid');
  invariant(finite(value.fontSize, 0, 256) && (value.lineHeight === null || finite(value.lineHeight, 0, 512)), label + ': control font metric invalid');
  validateRect(value.rect, label + '.rect', true);
  validateScroll(value.scroll, label + '.scroll');
}

function validateSemanticIndicator(value, label) {
  exactKeys(value, ['kind', 'text', 'ariaLabel', 'nativeDisabled', 'ariaDisabled', 'ariaSelected', 'ariaCurrent', 'ariaValueNow', 'ariaValueMax', 'role', 'visible'], label);
  invariant(['disabled', 'locked', 'selected', 'hp'].includes(value.kind) && [value.text, value.ariaLabel, value.ariaDisabled, value.ariaSelected, value.ariaCurrent, value.ariaValueNow, value.ariaValueMax, value.role].every((entry) => safeString(entry, 240)), label + ': semantic indicator invalid');
  invariant(typeof value.nativeDisabled === 'boolean' && typeof value.visible === 'boolean', label + ': semantic indicator visibility invalid');
}

function validateState(value, label) {
  exactKeys(value, ['canonicalId', 'state', 'text', 'rect', 'visible'], label);
  invariant(safeString(value.canonicalId, 160) && safeString(value.state, 80) && safeString(value.text, 240), label + ': state strings invalid');
  validateRect(value.rect, label + '.rect', true);
  invariant(typeof value.visible === 'boolean', label + ': visible invalid');
}

function validatePartyState(value, label) {
  exactKeys(value, ['canonicalId', 'state', 'text', 'rect', 'visible', 'semanticShape', 'iconPathData', 'borderStyle', 'borderWidth', 'borderRadius', 'clipPath', 'beforeContent', 'beforeClipPath', 'afterContent', 'afterClipPath'], label);
  invariant([value.canonicalId, value.state, value.text, value.semanticShape, value.iconPathData, value.borderStyle, value.borderWidth, value.borderRadius, value.clipPath, value.beforeContent, value.beforeClipPath, value.afterContent, value.afterClipPath].every((entry) => safeString(entry, 1000)), label + ': party state string invalid');
  validateRect(value.rect, label + '.rect', true); invariant(typeof value.visible === 'boolean', label + ': party state visibility invalid');
}

function validateUnit(value, label, nullable = false) {
  if (nullable && value === null) return;
  exactKeys(value, ['canonicalId', 'canonicalKind', 'visible', 'rect', 'artRect', 'preTransformRect', 'sourceAsset', 'sourceFrameId', 'sourceUrl', 'objectFit', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'transform', 'transformMatrix', 'transformOrigin', 'opacity', 'declaredFootAnchor'], label);
  for (const key of ['canonicalId', 'canonicalKind', 'sourceAsset', 'sourceFrameId', 'sourceUrl', 'objectFit', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'transform', 'transformOrigin']) invariant(safeString(value[key], 1000), label + ': invalid ' + key);
  invariant(typeof value.visible === 'boolean' && (value.opacity === null || finite(value.opacity, 0, 1)), label + ': visibility/opacity invalid');
  validateRect(value.rect, label + '.rect', true);
  validateRect(value.artRect, label + '.artRect', true);
  validateRect(value.preTransformRect, label + '.preTransformRect', true);
  invariant(Array.isArray(value.transformMatrix) && value.transformMatrix.length === 6 && value.transformMatrix.every((entry) => finite(entry, -10000, 10000)), label + ': transform matrix invalid');
  exactKeys(value.declaredFootAnchor, ['x', 'y'], label + '.declaredFootAnchor');
  invariant(finite(value.declaredFootAnchor.x, 0, 10000) && finite(value.declaredFootAnchor.y, 0, 10000), label + ': declared foot anchor invalid');
}

function validateRevisionContract(requestedChanges) {
  invariant(Array.isArray(requestedChanges) && requestedChanges.length > 0 && requestedChanges.length <= 20, 'revision requestedChanges invalid');
  const requestIds = new Set(); const assertionIds = new Set(); const definitions = []; const assetOwners = new Map();
  for (const request of requestedChanges) {
    invariant(typeof request.id === 'string' && /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(request.id) && !requestIds.has(request.id), 'revision request id invalid/duplicate'); requestIds.add(request.id);
    invariant(Array.isArray(request.affectedGoldenMasters) && request.affectedGoldenMasters.length > 0 && JSON.stringify(request.affectedGoldenMasters) === JSON.stringify([...new Set(request.affectedGoldenMasters)].sort()) && request.affectedGoldenMasters.every((id) => /^GM0[1-8]$/.test(id)), request.id + ': affected GM list invalid');
    invariant(Array.isArray(request.targetPaths) && request.targetPaths.length > 0 && JSON.stringify(request.targetPaths) === JSON.stringify([...new Set(request.targetPaths)].sort()) && request.targetPaths.every((target) => safeString(target, 240) && !target.startsWith('/') && !target.includes('..') && /^[a-zA-Z0-9._/-]+$/.test(target)), request.id + ': targetPaths invalid');
    invariant(Array.isArray(request.supersedesAssertions) && JSON.stringify(request.supersedesAssertions) === JSON.stringify([...new Set(request.supersedesAssertions)].sort()) && request.supersedesAssertions.every((id) => /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(id)), request.id + ': supersedesAssertions invalid');
    invariant(Array.isArray(request.requiredAssets) && JSON.stringify(request.requiredAssets) === JSON.stringify([...new Set(request.requiredAssets)].sort()) && request.requiredAssets.every((assetPath) => /^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|svg)$/i.test(assetPath) && !assetPath.includes('..')), request.id + ': requiredAssets invalid');
    const targetAssetPrefix = 'step4/s02/golden-master-p1/';
    const targetAssets = request.targetPaths.filter((target) => target.startsWith(targetAssetPrefix + 'assets/')).map((target) => target.slice(targetAssetPrefix.length)).sort();
    invariant(JSON.stringify(request.requiredAssets) === JSON.stringify(targetAssets), request.id + ': requiredAssets must exactly equal route-asset targetPaths');
    for (const assetPath of request.requiredAssets) { const owner = assetOwners.get(assetPath) ?? { requestIds: new Set(), goldenMasters: new Set() }; owner.requestIds.add(request.id); request.affectedGoldenMasters.forEach((id) => owner.goldenMasters.add(id)); assetOwners.set(assetPath, owner); }
    invariant(Array.isArray(request.acceptanceAssertions) && request.acceptanceAssertions.length >= 1 && request.acceptanceAssertions.length <= 20, request.id + ': acceptance assertion count invalid');
    const coveredGoldenMasters = new Set();
    for (const assertion of request.acceptanceAssertions) {
      const common = ['id', 'type', 'goldenMaster'];
      invariant(typeof assertion.id === 'string' && /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(assertion.id) && !assertionIds.has(assertion.id), request.id + ': assertion id invalid/duplicate'); assertionIds.add(assertion.id);
      invariant(/^GM0[1-8]$/.test(assertion.goldenMaster) && request.affectedGoldenMasters.includes(assertion.goldenMaster), assertion.id + ': assertion GM outside request scope');
      coveredGoldenMasters.add(assertion.goldenMaster);
      if (assertion.type === 'DOM_RECT_DELTA') { exactKeys(assertion, [...common, 'selector', 'property', 'operator', 'threshold'], assertion.id); invariant(['width', 'height', 'x', 'y'].includes(assertion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(assertion.operator) && finite(assertion.threshold, assertion.operator === 'ABS_DELTA_GTE' ? 0 : -10000, 10000), assertion.id + ': rect contract invalid'); }
      else if (assertion.type === 'DOM_STYLE_DELTA') {
        exactKeys(assertion, [...common, 'selector', 'property', 'operator', 'threshold'], assertion.id);
        const numeric = ['font-size', 'opacity'].includes(assertion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(assertion.operator) && finite(assertion.threshold, assertion.operator === 'ABS_DELTA_GTE' ? 0 : -10000, 10000);
        const string = ['color', 'background-color'].includes(assertion.property) && ((assertion.operator === 'CHANGED' && assertion.threshold === null) || (assertion.operator === 'AFTER_EQUALS' && safeString(assertion.threshold, 120)));
        invariant(numeric || string, assertion.id + ': style contract invalid');
      } else if (assertion.type === 'ROI_PIXEL_DELTA') {
        exactKeys(assertion, [...common, 'region', 'changedPixelRatio', 'meanAbsoluteChannelDelta'], assertion.id); exactKeys(assertion.region, ['x', 'y', 'width', 'height'], assertion.id + '.region');
        invariant(Object.values(assertion.region).every((value) => finite(value, 0, 1)) && assertion.region.width > 0 && assertion.region.height > 0 && assertion.region.x + assertion.region.width <= 1 && assertion.region.y + assertion.region.height <= 1, assertion.id + ': ROI invalid');
        for (const key of ['changedPixelRatio', 'meanAbsoluteChannelDelta']) invariant(Array.isArray(assertion[key]) && assertion[key].length === 2 && assertion[key].every((value) => finite(value, 0, key === 'changedPixelRatio' ? 1 : 255)) && assertion[key][0] <= assertion[key][1], assertion.id + ': ROI threshold invalid');
      } else if (assertion.type === 'TEXT_EXACT') { exactKeys(assertion, [...common, 'selector', 'expected'], assertion.id); invariant(safeString(assertion.expected, 240) && assertion.expected.length > 0 && assertion.expected === assertion.expected.replace(/\s+/gu, ' ').trim(), assertion.id + ': expected text invalid/noncanonical whitespace'); }
      else if (assertion.type === 'ELEMENT_VISIBLE') { exactKeys(assertion, [...common, 'selector', 'minimumArea'], assertion.id); invariant(finite(assertion.minimumArea, 1, 1000000), assertion.id + ': minimumArea invalid'); }
      else invariant(false, assertion.id + ': unsupported assertion type');
      if (assertion.type !== 'ROI_PIXEL_DELTA') invariant(safelyScopedSelector(assertion.selector), assertion.id + ': unsafe/out-of-root selector');
      definitions.push({ requestId: request.id, criterionSha256: canonicalSha256(assertion), originAffectedGoldenMasters: [...request.affectedGoldenMasters], originTargetPaths: [...request.targetPaths], assertion, ...assertion });
    }
    invariant(JSON.stringify([...coveredGoldenMasters].sort()) === JSON.stringify(request.affectedGoldenMasters), request.id + ': acceptance assertions do not cover every affected Golden Master');
  }
  const assets = [...assetOwners].sort(([left], [right]) => left.localeCompare(right)).map(([assetPath, owner]) => ({ path: assetPath, requestIds: [...owner.requestIds].sort(), goldenMasters: [...owner.goldenMasters].sort() }));
  return { definitions, assets };
}

function validateRequestMeasurement(entry, definition, label, allowAbsentIntroduction = false) {
  exactKeys(entry, ['requestId', 'assertionId', 'criterionSha256', 'type', 'goldenMaster', 'observed'], label);
  invariant(entry.requestId === definition.requestId && entry.assertionId === definition.id && entry.criterionSha256 === definition.criterionSha256 && /^sha256:[a-f0-9]{64}$/.test(entry.criterionSha256) && entry.type === definition.type && entry.goldenMaster === definition.goldenMaster, label + ': identity/order/criterion digest mismatch');
  const observed = entry.observed;
  if (entry.type === 'DOM_RECT_DELTA') { exactKeys(observed, ['selectorCount', 'visible', 'rect'], label + '.observed'); invariant(observed.selectorCount === 1 && typeof observed.visible === 'boolean', label + ': selector count/visibility mismatch'); exactKeys(observed.rect, ['x', 'y', 'width', 'height'], label + '.rect'); Object.values(observed.rect).forEach((value) => invariant(finite(value), label + ': rect invalid')); }
  else if (entry.type === 'DOM_STYLE_DELTA') { exactKeys(observed, ['selectorCount', 'visible', 'value'], label + '.observed'); invariant(observed.selectorCount === 1 && typeof observed.visible === 'boolean' && safeString(observed.value, 120), label + ': style observed invalid'); }
  else if (entry.type === 'TEXT_EXACT') {
    exactKeys(observed, ['selectorCount', 'visible', 'text'], label + '.observed');
    const absent = allowAbsentIntroduction && observed.selectorCount === 0 && observed.visible === false && observed.text === '';
    invariant(absent || (observed.selectorCount === 1 && typeof observed.visible === 'boolean' && safeString(observed.text, 240)), label + ': text observed invalid');
  } else if (entry.type === 'ELEMENT_VISIBLE') {
    exactKeys(observed, ['selectorCount', 'visible', 'area'], label + '.observed');
    const absent = allowAbsentIntroduction && observed.selectorCount === 0 && observed.visible === false && observed.area === 0;
    invariant(absent || (observed.selectorCount === 1 && typeof observed.visible === 'boolean' && finite(observed.area, 0, 1000000)), label + ': visibility observed invalid');
  }
  else { exactKeys(observed, ['screenshotPath', 'region'], label + '.observed'); invariant(safeString(observed.screenshotPath, 300), label + ': ROI path invalid'); exactKeys(observed.region, ['x', 'y', 'width', 'height'], label + '.region'); invariant(JSON.stringify(observed.region) === JSON.stringify(definition.region), label + ': ROI differs from immutable lock'); }
}

function validateAssetParticipation(entries, label) {
  invariant(Array.isArray(entries) && entries.length <= 80, label + ': invalid count');
  invariant(JSON.stringify(entries.map((entry) => entry.path)) === JSON.stringify(entries.map((entry) => entry.path).sort()), label + ': path order invalid');
  for (const entry of entries) {
    exactKeys(entry, ['path', 'goldenMasters', 'requestIds', 'requests', 'domReferences'], label + '.' + entry.path);
    invariant(/^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|svg)$/i.test(entry.path) && JSON.stringify(entry.goldenMasters) === JSON.stringify([...new Set(entry.goldenMasters)].sort()) && JSON.stringify(entry.requestIds) === JSON.stringify([...new Set(entry.requestIds)].sort()), label + ': asset identity/order invalid');
    invariant(Array.isArray(entry.requests) && Array.isArray(entry.domReferences), label + ': participation lists invalid');
    entry.requests.forEach((request, index) => { exactKeys(request, ['goldenMaster', 'url', 'status', 'contentType', 'sha256', 'decoded'], label + '.request[' + String(index) + ']'); invariant(/^GM0[1-8]$/.test(request.goldenMaster) && safeString(request.url, 2000) && Number.isSafeInteger(request.status) && safeString(request.contentType, 240) && safeString(request.sha256, 80) && typeof request.decoded === 'boolean', label + ': request invalid'); });
    entry.domReferences.forEach((reference, index) => { exactKeys(reference, ['goldenMaster', 'selector', 'property', 'resolvedUrl', 'visibleArea', 'surface'], label + '.reference[' + String(index) + ']'); invariant(/^GM0[1-8]$/.test(reference.goldenMaster) && safeString(reference.selector, 400) && ['src', 'background-image', 'mask-image'].includes(reference.property) && safeString(reference.resolvedUrl, 2000) && finite(reference.visibleArea, 64, 1000000) && ['game', 'review'].includes(reference.surface), label + ': DOM reference invalid or visually inert'); });
  }
}

function validateRaw(raw, options = {}) {
  const scenarioExpectations = options.scenarios ?? expectedScenarios;
  const expectedArtifactId = options.artifactId ?? 'cats-tower-s02-golden-master-p1-browser-raw-round-001';
  const expectedBaseUrl = options.baseUrl ?? baseUrl;
  const expectedHead = options.head ?? (process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']));
  const expectedTree = options.tree ?? git(['rev-parse', 'HEAD^{tree}']);
  const screenshotPrefix = options.screenshotPrefix ?? 'semantic-evidence/screenshots/';
  const requestDefinitions = options.requestDefinitions ?? null;
  const expectsAssetParticipation = options.assetParticipation === true;
  const expectsOfflineVariants = options.offlineVariants === true;
  const expectsBrowserModes = options.browserModes === true;
  exactKeys(raw, ['schemaVersion', 'artifactId', 'repository', 'branch', 'head', 'tree', 'baseUrl', 'playwrightVersion', 'chromiumVersion', 'scenarios', ...(expectsOfflineVariants ? ['offlineVariants'] : []), ...(expectsBrowserModes ? ['browserModes'] : []), ...(requestDefinitions ? ['requestMeasurements'] : []), ...(expectsAssetParticipation ? ['assetParticipation'] : [])], 'raw');
  invariant(raw.schemaVersion === 1 && raw.artifactId === expectedArtifactId, 'raw identity mismatch');
  invariant(raw.repository === repository && raw.branch === branch && raw.baseUrl === expectedBaseUrl, 'raw repository/route mismatch');
  invariant(/^[a-f0-9]{40}$/.test(raw.head) && /^[a-f0-9]{40}$/.test(raw.tree), 'raw Git identity invalid');
  invariant(raw.head === expectedHead && raw.tree === expectedTree, 'raw does not bind its exact expected tree');
  invariant(raw.playwrightVersion === '1.62.0' && safeString(raw.chromiumVersion, 120), 'raw browser lock mismatch');
  invariant(Array.isArray(raw.scenarios) && raw.scenarios.length === scenarioExpectations.length, 'raw scenario count mismatch');
  raw.scenarios.forEach((scenario, index) => {
    const expected = scenarioExpectations[index];
    const label = 'scenario[' + String(index) + ']';
    exactKeys(scenario, ['id', 'gm', 'state', 'viewport', 'route', 'environment', 'diagnostics', 'document', 'elements', 'assets', 'semantics', 'screenshot'], label);
    invariant(scenario.id === expected.id && scenario.gm === expected.gm && scenario.state === expected.state, label + ': identity/order mismatch');
    exactKeys(scenario.viewport, ['label', 'width', 'height'], label + '.viewport');
    invariant(scenario.viewport.label === expected.label && scenario.viewport.width === expected.width && scenario.viewport.height === expected.height, label + ': viewport mismatch');
    exactKeys(scenario.route, ['path', 'search', 'status', 'redirectCount'], label + '.route');
    invariant(scenario.route.path === '/step4/s02/golden-master-p1/' && scenario.route.search === expected.search && Number.isSafeInteger(scenario.route.status) && Number.isSafeInteger(scenario.route.redirectCount), label + ': route mismatch');
    exactKeys(scenario.environment, ['innerWidth', 'innerHeight', 'devicePixelRatio', 'locale', 'reducedMotion', 'visualViewport', 'reducedMotionPolicy', 'captureStabilization', 'surfaceGeometry', 'safeAreaInsets', 'rootFontSize', 'textScalePercent'], label + '.environment');
    invariant(scenario.environment.innerWidth === expected.width && scenario.environment.innerHeight === expected.height && scenario.environment.devicePixelRatio === 1, label + ': actual browser viewport mismatch');
    invariant(scenario.environment.locale.toLowerCase().startsWith('ja') && scenario.environment.reducedMotion === true, label + ': locale/reduced-motion mismatch');
    exactKeys(scenario.environment.visualViewport, ['width', 'height', 'offsetLeft', 'offsetTop', 'scale', 'pageLeft', 'pageTop'], label + '.visualViewport');
    for (const key of Object.keys(scenario.environment.visualViewport)) invariant(finite(scenario.environment.visualViewport[key], key === 'scale' ? 0.01 : -100000, key === 'scale' ? 20 : 100000), label + ': visual viewport metric invalid ' + key);
    invariant(Math.abs(scenario.environment.visualViewport.width - expected.width) <= 0.01 && Math.abs(scenario.environment.visualViewport.height - expected.height) <= 0.01 && scenario.environment.visualViewport.offsetLeft === 0 && scenario.environment.visualViewport.offsetTop === 0 && scenario.environment.visualViewport.scale === 1 && scenario.environment.visualViewport.pageLeft === 0 && scenario.environment.visualViewport.pageTop === 0, label + ': visual viewport does not match the initial layout viewport');
    exactKeys(scenario.environment.reducedMotionPolicy, ['prefersReducedMotion', 'stabilizationApplied', 'targets'], label + '.reducedMotionPolicy');
    invariant(scenario.environment.reducedMotionPolicy.prefersReducedMotion === true && scenario.environment.reducedMotionPolicy.stabilizationApplied === false && Array.isArray(scenario.environment.reducedMotionPolicy.targets), label + ': pre-stabilization reduced-motion boundary invalid');
    invariant(JSON.stringify(scenario.environment.reducedMotionPolicy.targets.map((entry) => entry.kind)) === JSON.stringify(['background', 'cat-idle', 'enemy-idle', 'offline-progress', 'combat-effects']), label + ': reduced-motion target groups mismatch');
    scenario.environment.reducedMotionPolicy.targets.forEach((target, targetIndex) => {
      exactKeys(target, ['kind', 'records'], label + '.motionTarget[' + String(targetIndex) + ']');
      invariant(Array.isArray(target.records) && target.records.length <= 50, label + ': reduced-motion record list invalid');
      target.records.forEach((record, recordIndex) => { exactKeys(record, ['animationName', 'animationDuration', 'animationIterationCount', 'transitionDuration'], label + '.motionRecord[' + String(recordIndex) + ']'); invariant(Object.values(record).every((entry) => safeString(entry, 240)), label + ': reduced-motion computed style invalid'); });
    });
    exactKeys(scenario.environment.captureStabilization, ['appliedAfterPolicyCollection', 'cssSha256'], label + '.captureStabilization');
    invariant(scenario.environment.captureStabilization.appliedAfterPolicyCollection === true && /^sha256:[a-f0-9]{64}$/.test(scenario.environment.captureStabilization.cssSha256), label + ': capture stabilization record invalid');
    invariant(Array.isArray(scenario.environment.surfaceGeometry) && scenario.environment.surfaceGeometry.length === 5, label + ': surface geometry count mismatch');
    invariant(JSON.stringify(scenario.environment.surfaceGeometry.map((entry) => entry.name)) === JSON.stringify(['html', 'body', 'review-stage', 'gm-stage', 'game-ui']), label + ': surface geometry order mismatch');
    scenario.environment.surfaceGeometry.forEach((surface, surfaceIndex) => {
      exactKeys(surface, ['name', 'transform', 'transformMatrix', 'transformOrigin', 'zoom', 'rect', 'rectToLayoutViewport'], label + '.surface[' + String(surfaceIndex) + ']');
      invariant(safeString(surface.name, 40) && safeString(surface.transform, 240) && safeString(surface.transformOrigin, 240) && finite(surface.zoom, 0.01, 20), label + ': surface style invalid');
      invariant(surface.transformMatrix === null || (Array.isArray(surface.transformMatrix) && surface.transformMatrix.length === 6 && surface.transformMatrix.every((value) => finite(value))), label + ': transform matrix invalid');
      validateRect(surface.rect, label + '.surface.rect'); exactKeys(surface.rectToLayoutViewport, ['width', 'height'], label + '.surfaceRatio');
      invariant(finite(surface.rectToLayoutViewport.width, 0, 100) && finite(surface.rectToLayoutViewport.height, 0, 100), label + ': surface ratio invalid');
    });
    exactKeys(scenario.environment.safeAreaInsets, ['top', 'right', 'bottom', 'left'], label + '.safeAreaInsets');
    for (const value of Object.values(scenario.environment.safeAreaInsets)) invariant(finite(value, 0, 200), label + ': safe inset invalid');
    invariant(finite(scenario.environment.rootFontSize, 1, 128) && [100, 200].includes(scenario.environment.textScalePercent), label + ': text scale invalid');
    exactKeys(scenario.diagnostics, ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths', 'unexpectedResponses'], label + '.diagnostics');
    for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths']) invariant(Array.isArray(scenario.diagnostics[key]) && scenario.diagnostics[key].length <= 100 && scenario.diagnostics[key].every((entry) => safeString(entry, 2000)), label + ': diagnostics invalid ' + key);
    invariant(Array.isArray(scenario.diagnostics.unexpectedResponses) && scenario.diagnostics.unexpectedResponses.length <= 100, label + ': unexpected response list invalid');
    for (const response of scenario.diagnostics.unexpectedResponses) { exactKeys(response, ['url', 'status'], label + '.response'); invariant(safeString(response.url, 2000) && Number.isSafeInteger(response.status), label + ': unexpected response invalid'); }
    exactKeys(scenario.document, ['ready', 'title', 'fixtureId', 'synthetic', 'notRuntime', 'layoutViewport', 'responsiveEvidenceOverride', 'gameUiInert', 'gameUiAriaHidden', 'bodyText', 'stageText', 'gameUiText', 'stage', 'stageScroll', 'documentScroll', 'initialScrollX', 'initialScrollY', 'initialStageScrollTop'], label + '.document');
    invariant(safeString(scenario.document.ready, 20) && safeString(scenario.document.title, 240) && safeString(scenario.document.fixtureId, 120) && safeString(scenario.document.synthetic, 20) && safeString(scenario.document.notRuntime, 20) && safeString(scenario.document.layoutViewport, 40) && safeString(scenario.document.responsiveEvidenceOverride, 40) && typeof scenario.document.gameUiInert === 'boolean' && safeString(scenario.document.gameUiAriaHidden, 20) && safeString(scenario.document.bodyText, 20000) && safeString(scenario.document.stageText, 12000) && safeString(scenario.document.gameUiText, 12000), label + ': document strings/state invalid');
    invariant(scenario.document.fixtureId === `s02.p1.fixture.${scenario.gm}` && scenario.document.synthetic === 'true' && scenario.document.notRuntime === 'true' && scenario.document.layoutViewport === `${expected.width}x${expected.height}` && scenario.document.responsiveEvidenceOverride === (expected.responsiveOverride ?? ''), label + ': ordinary DOM fixture identity/synthetic/layout boundary mismatch');
    validateRect(scenario.document.stage, label + '.stage'); validateScroll(scenario.document.stageScroll, label + '.stageScroll'); validateScroll(scenario.document.documentScroll, label + '.documentScroll');
    invariant(scenario.document.initialScrollX === 0 && scenario.document.initialScrollY === 0 && scenario.document.initialStageScrollTop === 0, label + ': initial scroll origin must be exact zero before review operations');
    exactKeys(scenario.elements, ['battlefield', 'bottomNavigation', 'navigationScrollProbe', 'partyDock', 'enemy', 'cats', 'meaningfulText', 'primaryLabels', 'navigationLabels', 'controls', 'criticalLabels', 'semanticIndicators', 'combatMarkers', 'partyStates', 'support', 'offlineModal', 'offlineProgress', 'densityMetrics', 'layoutMetrics'], label + '.elements');
    validateBox(scenario.elements.battlefield, label + '.battlefield'); validateBox(scenario.elements.bottomNavigation, label + '.bottomNavigation'); validateBox(scenario.elements.partyDock, label + '.partyDock'); validateUnit(scenario.elements.enemy, label + '.enemy', true);
    const navProbe = scenario.elements.navigationScrollProbe;
    exactKeys(navProbe, ['performed', 'safeBottom', 'scrollTopInitial', 'scrollTopAfter', 'scrollHeight', 'clientHeight', 'navRectAfter', 'labelsAfter', 'controlsAfter', 'focusReached'], label + '.navigationScrollProbe');
    invariant(typeof navProbe.performed === 'boolean' && finite(navProbe.safeBottom, 0, 200) && finite(navProbe.scrollTopInitial, 0, 100000) && finite(navProbe.scrollTopAfter, 0, 100000) && Number.isSafeInteger(navProbe.scrollHeight) && Number.isSafeInteger(navProbe.clientHeight) && Array.isArray(navProbe.labelsAfter) && Array.isArray(navProbe.controlsAfter) && typeof navProbe.focusReached === 'boolean', label + ': navigation scroll probe invalid');
    invariant(Math.abs(navProbe.safeBottom - scenario.environment.safeAreaInsets.bottom) <= 0.5, label + ': navigation probe safe-bottom mismatch');
    validateRect(navProbe.navRectAfter, label + '.navigationScrollProbe.navRectAfter', true);
    navProbe.labelsAfter.forEach((entry, item) => validateText(entry, label + '.navigationScrollProbe.label[' + String(item) + ']'));
    navProbe.controlsAfter.forEach((entry, item) => validateControl(entry, label + '.navigationScrollProbe.control[' + String(item) + ']'));
    invariant(Array.isArray(scenario.elements.cats) && scenario.elements.cats.length <= 4, label + ': cats invalid'); scenario.elements.cats.forEach((entry, item) => validateUnit(entry, label + '.cat[' + String(item) + ']'));
    for (const key of ['meaningfulText', 'primaryLabels', 'navigationLabels', 'criticalLabels']) { invariant(Array.isArray(scenario.elements[key]) && scenario.elements[key].length <= 500, label + ': invalid ' + key); scenario.elements[key].forEach((entry, item) => validateText(entry, label + '.' + key + '[' + String(item) + ']')); }
    invariant(Array.isArray(scenario.elements.controls) && scenario.elements.controls.length <= 200, label + ': controls invalid'); scenario.elements.controls.forEach((entry, item) => validateControl(entry, label + '.control[' + String(item) + ']'));
    invariant(Array.isArray(scenario.elements.semanticIndicators) && scenario.elements.semanticIndicators.length <= 200, label + ': semantic indicators invalid'); scenario.elements.semanticIndicators.forEach((entry, item) => validateSemanticIndicator(entry, label + '.semanticIndicator[' + String(item) + ']'));
    invariant(Array.isArray(scenario.elements.combatMarkers) && scenario.elements.combatMarkers.length <= 16, label + ': markers invalid');
    scenario.elements.combatMarkers.forEach((entry, item) => {
      const markerKeys = ['kind', 'text', 'semanticShape', 'borderRightWidth', 'borderRadius', 'clipPath', 'rect', 'visible', 'eventId', 'eventType', 'simulationTick', 'stateVersion', 'sourceEntityId', 'targetEntityId', 'entityId', 'causeEventId', 'attackEventId', 'projectileEntityId', 'arrivalEventId', 'damageEventId', 'rewardEventId', 'settlementId', 'currencyCanonicalId', 'amountDecimal', 'critical', 'defeatEventId', 'effectClip', 'flashActive', 'targetAnchor', 'releaseEventId', 'releaseEventType', 'releaseSimulationTick', 'releaseStateVersion', 'releaseSourceEntityId', 'spawnEventId', 'spawnEventType', 'spawnSimulationTick', 'spawnStateVersion', 'spawnProjectileEntityId', 'spawnSourceEntityId', 'spawnTargetEntityId', 'spawnAttackEventId'];
      exactKeys(entry, markerKeys, label + '.marker[' + String(item) + ']');
      invariant(markerKeys.filter((key) => !['rect', 'visible'].includes(key)).every((key) => safeString(entry[key], key === 'text' ? 240 : key === 'clipPath' ? 500 : 200)) && typeof entry.visible === 'boolean', label + ': marker invalid');
      validateRect(entry.rect, label + '.marker.rect', true);
    });
    invariant(Array.isArray(scenario.elements.partyStates) && scenario.elements.partyStates.length <= 4, label + ': party states invalid'); scenario.elements.partyStates.forEach((entry, item) => validatePartyState(entry, label + '.partyState[' + String(item) + ']'));
    if (scenario.elements.support !== null) validateState(scenario.elements.support, label + '.support');
    if (scenario.elements.offlineModal !== null) {
      exactKeys(scenario.elements.offlineModal, ['label', 'role', 'ariaModal', 'labelledBy', 'elapsedSeconds', 'capSeconds', 'rect', 'visible', 'controls', 'fixedScrollProbe'], label + '.offlineModal');
      invariant(safeString(scenario.elements.offlineModal.label, 1200) && safeString(scenario.elements.offlineModal.role, 80) && safeString(scenario.elements.offlineModal.ariaModal, 20) && safeString(scenario.elements.offlineModal.labelledBy, 240) && safeString(scenario.elements.offlineModal.elapsedSeconds, 80) && safeString(scenario.elements.offlineModal.capSeconds, 80) && typeof scenario.elements.offlineModal.visible === 'boolean' && Array.isArray(scenario.elements.offlineModal.controls), label + ': offline modal invalid');
      validateRect(scenario.elements.offlineModal.rect, label + '.offlineModal.rect'); scenario.elements.offlineModal.controls.forEach((entry, item) => validateControl(entry, label + '.offlineControl[' + String(item) + ']'));
      const probe = scenario.elements.offlineModal.fixedScrollProbe;
      exactKeys(probe, ['headInitial', 'headAfter', 'body', 'footerInitial', 'footerAfter', 'scrollTopInitial', 'scrollTopAfter', 'scrollHeight', 'clientHeight', 'bodyTabIndex', 'bodyRole', 'bodyAriaLabel'], label + '.fixedScrollProbe');
      for (const key of ['headInitial', 'headAfter', 'body', 'footerInitial', 'footerAfter']) validateRect(probe[key], label + '.fixedScrollProbe.' + key, true);
      invariant(finite(probe.scrollTopInitial, 0, 100000) && finite(probe.scrollTopAfter, 0, 100000) && Number.isSafeInteger(probe.scrollHeight) && Number.isSafeInteger(probe.clientHeight) && safeString(probe.bodyTabIndex, 20) && safeString(probe.bodyRole, 80) && safeString(probe.bodyAriaLabel, 240), label + ': fixed scroll probe invalid');
    }
    if (scenario.elements.offlineProgress !== null) { exactKeys(scenario.elements.offlineProgress, ['role', 'ariaValueNow', 'ariaValueMax', 'rect', 'visible'], label + '.offlineProgress'); invariant(safeString(scenario.elements.offlineProgress.role, 80) && safeString(scenario.elements.offlineProgress.ariaValueNow, 80) && safeString(scenario.elements.offlineProgress.ariaValueMax, 80) && typeof scenario.elements.offlineProgress.visible === 'boolean', label + ': offline progress invalid'); validateRect(scenario.elements.offlineProgress.rect, label + '.offlineProgress.rect'); }
    const density = scenario.elements.densityMetrics;
    exactKeys(density, ['header', 'resourceChips', 'primaryControl', 'bottomNavigation', 'navigationControls'], label + '.densityMetrics');
    validateDensityMetric(density.header, label + '.density.header'); validateDensityMetric(density.primaryControl, label + '.density.primary'); validateDensityMetric(density.bottomNavigation, label + '.density.nav');
    invariant(Array.isArray(density.resourceChips) && density.resourceChips.length >= 1 && density.resourceChips.length <= 8, label + ': density resource chips invalid'); density.resourceChips.forEach((entry, item) => validateDensityMetric(entry, label + '.density.chip[' + String(item) + ']'));
    invariant(Array.isArray(density.navigationControls) && density.navigationControls.length === 5, label + ': density nav controls invalid'); density.navigationControls.forEach((entry, item) => validateDensityMetric(entry, label + '.density.navControl[' + String(item) + ']'));
    const layout = scenario.elements.layoutMetrics;
    exactKeys(layout, ['header', 'battlefield', 'partyCards', 'partyInterCardGaps', 'primaryControl', 'bottomNavigation', 'navigationControls'], label + '.layoutMetrics');
    validateStyleBox(layout.header, label + '.layout.header'); validateStyleBox(layout.battlefield, label + '.layout.battlefield'); validateStyleBox(layout.primaryControl, label + '.layout.primary'); validateStyleBox(layout.bottomNavigation, label + '.layout.nav');
    invariant(Array.isArray(layout.partyCards) && layout.partyCards.length === 4, label + ': layout party cards invalid'); layout.partyCards.forEach((entry, item) => validateRect(entry, label + '.layout.party[' + String(item) + ']'));
    const expectedPartyGapSignature = scenario.environment.textScalePercent === 200
      ? ['0:1:horizontal', '0:2:vertical', '1:3:vertical', '2:3:horizontal']
      : ['0:1:horizontal', '1:2:horizontal', '2:3:horizontal'];
    invariant(Array.isArray(layout.partyInterCardGaps) && layout.partyInterCardGaps.length === expectedPartyGapSignature.length, label + ': layout party gap count does not match the 4-column or 2x2 contract');
    layout.partyInterCardGaps.forEach((entry, item) => { exactKeys(entry, ['firstIndex', 'secondIndex', 'axis', 'gap'], label + '.layout.partyGap[' + String(item) + ']'); invariant(Number.isSafeInteger(entry.firstIndex) && Number.isSafeInteger(entry.secondIndex) && entry.firstIndex >= 0 && entry.secondIndex > entry.firstIndex && entry.secondIndex < 4 && ['horizontal', 'vertical'].includes(entry.axis) && finite(entry.gap, 0, 500), label + ': party gap record invalid'); });
    invariant(JSON.stringify(layout.partyInterCardGaps.map((entry) => `${entry.firstIndex}:${entry.secondIndex}:${entry.axis}`)) === JSON.stringify(expectedPartyGapSignature), label + ': layout party adjacency graph mismatch');
    invariant(Array.isArray(layout.navigationControls) && layout.navigationControls.length === 5, label + ': layout nav controls invalid'); layout.navigationControls.forEach((entry, item) => validateStyleBox(entry, label + '.layout.navControl[' + String(item) + ']'));
    invariant(Array.isArray(scenario.assets) && scenario.assets.length >= 9 && scenario.assets.length <= 80, label + ': asset frame evidence count invalid');
    scenario.assets.forEach((asset, item) => {
      const assetLabel = label + '.asset[' + String(item) + ']';
      exactKeys(asset, ['path', 'naturalWidth', 'naturalHeight', 'frameId', 'sourceRect', 'visibleBounds', 'footAnchor', 'hitBounds', 'containsEffects', 'alphaBounds', 'alphaThreshold', 'connectivity', 'minimumComponentRatio', 'opaquePixelCount', 'totalPixelCount', 'pixelSha256'], assetLabel);
      invariant(safeString(asset.path, 240) && safeString(asset.frameId, 120) && /^[a-f0-9]{64}$/.test(asset.pixelSha256.slice(7)) && asset.pixelSha256.startsWith('sha256:'), assetLabel + ': identity invalid');
      invariant(Number.isSafeInteger(asset.naturalWidth) && Number.isSafeInteger(asset.naturalHeight) && asset.naturalWidth > 0 && asset.naturalHeight > 0, assetLabel + ': natural dimensions invalid');
      exactKeys(asset.sourceRect, ['x', 'y', 'width', 'height'], assetLabel + '.sourceRect');
      for (const key of ['x', 'y', 'width', 'height']) invariant(Number.isSafeInteger(asset.sourceRect[key]) && asset.sourceRect[key] >= 0, assetLabel + ': source rect invalid');
      exactKeys(asset.visibleBounds, ['x', 'y', 'width', 'height'], assetLabel + '.visibleBounds');
      for (const key of ['x', 'y', 'width', 'height']) invariant(Number.isSafeInteger(asset.visibleBounds[key]) && asset.visibleBounds[key] >= 0, assetLabel + ': manifest visible bounds invalid');
      invariant((asset.footAnchor === null && asset.hitBounds === null) || (asset.footAnchor !== null && asset.hitBounds !== null), assetLabel + ': foot/hit anchor nullability mismatch');
      if (asset.footAnchor !== null) {
        exactKeys(asset.footAnchor, ['x', 'y'], assetLabel + '.footAnchor'); exactKeys(asset.hitBounds, ['x', 'y', 'width', 'height'], assetLabel + '.hitBounds');
        for (const key of ['x', 'y']) invariant(Number.isSafeInteger(asset.footAnchor[key]) && asset.footAnchor[key] >= 0, assetLabel + ': manifest foot anchor invalid');
        for (const key of ['x', 'y', 'width', 'height']) invariant(Number.isSafeInteger(asset.hitBounds[key]) && asset.hitBounds[key] >= 0, assetLabel + ': manifest hit bounds invalid');
        invariant(asset.hitBounds.x + asset.hitBounds.width <= asset.sourceRect.width && asset.hitBounds.y + asset.hitBounds.height <= asset.sourceRect.height && asset.footAnchor.x <= asset.sourceRect.width && asset.footAnchor.y <= asset.sourceRect.height, assetLabel + ': manifest foot/hit bounds escape frame');
      }
      invariant(asset.visibleBounds.x + asset.visibleBounds.width <= asset.sourceRect.width && asset.visibleBounds.y + asset.visibleBounds.height <= asset.sourceRect.height && typeof asset.containsEffects === 'boolean', assetLabel + ': manifest visible bounds escape frame');
      exactKeys(asset.alphaBounds, ['left', 'top', 'right', 'bottom', 'width', 'height'], assetLabel + '.alphaBounds');
      for (const key of Object.keys(asset.alphaBounds)) invariant(Number.isSafeInteger(asset.alphaBounds[key]) && asset.alphaBounds[key] >= 0, assetLabel + ': alpha bounds invalid');
      invariant(asset.sourceRect.width > 0 && asset.sourceRect.height > 0 && asset.sourceRect.x + asset.sourceRect.width <= asset.naturalWidth && asset.sourceRect.y + asset.sourceRect.height <= asset.naturalHeight, assetLabel + ': source rect escapes decoded asset');
      invariant(asset.alphaBounds.right <= asset.sourceRect.width && asset.alphaBounds.bottom <= asset.sourceRect.height && asset.alphaBounds.width === asset.alphaBounds.right - asset.alphaBounds.left && asset.alphaBounds.height === asset.alphaBounds.bottom - asset.alphaBounds.top, assetLabel + ': alpha bounds escape frame');
      invariant(asset.alphaThreshold === 32 && asset.connectivity === 8 && asset.minimumComponentRatio === 0.0025, assetLabel + ': visible-alpha component contract mismatch');
      invariant(Number.isSafeInteger(asset.opaquePixelCount) && Number.isSafeInteger(asset.totalPixelCount) && asset.opaquePixelCount > 0 && asset.opaquePixelCount <= asset.totalPixelCount && asset.totalPixelCount === asset.sourceRect.width * asset.sourceRect.height, assetLabel + ': alpha count invalid');
    });
    exactKeys(scenario.semantics, ['floor', 'areaDisplay', 'objective', 'killCounter', 'currencies', 'ranks', 'rewardStates', 'partyStateLabels', 'stageImages', 'largeImageLayers', 'assetDomReferences', 'reviewAssetReferences', 'dataBindings'], label + '.semantics');
    for (const key of ['floor', 'areaDisplay', 'objective', 'killCounter']) invariant(safeString(scenario.semantics[key], 240), label + ': semantic string invalid');
    for (const key of ['currencies', 'ranks', 'partyStateLabels']) invariant(Array.isArray(scenario.semantics[key]) && scenario.semantics[key].length <= 20 && scenario.semantics[key].every((entry) => safeString(entry, 240)), label + ': semantic list invalid ' + key);
    invariant(Array.isArray(scenario.semantics.rewardStates) && scenario.semantics.rewardStates.length <= 8, label + ': reward states invalid'); scenario.semantics.rewardStates.forEach((entry, item) => validateState(entry, label + '.rewardState[' + String(item) + ']'));
    invariant(Array.isArray(scenario.semantics.stageImages) && scenario.semantics.stageImages.length <= 50, label + ': image list invalid'); scenario.semantics.stageImages.forEach((image, item) => { exactKeys(image, ['source', 'complete', 'naturalWidth', 'naturalHeight'], label + '.image[' + String(item) + ']'); invariant(safeString(image.source, 1000) && typeof image.complete === 'boolean' && Number.isSafeInteger(image.naturalWidth) && Number.isSafeInteger(image.naturalHeight), label + ': image record invalid'); });
    invariant(Array.isArray(scenario.semantics.largeImageLayers) && scenario.semantics.largeImageLayers.length <= 8, label + ': large image layer list invalid'); scenario.semantics.largeImageLayers.forEach((layer, item) => { exactKeys(layer, ['tagName', 'kind', 'sourceAsset', 'backgroundImage', 'rect', 'visible'], label + '.largeImageLayer[' + String(item) + ']'); invariant([layer.tagName, layer.kind, layer.sourceAsset, layer.backgroundImage].every((entry) => safeString(entry, 1000)) && typeof layer.visible === 'boolean', label + ': large image layer invalid'); validateRect(layer.rect, label + '.largeImageLayer.rect'); });
    invariant(Array.isArray(scenario.semantics.assetDomReferences) && scenario.semantics.assetDomReferences.length <= 200, label + ': asset DOM reference list invalid'); scenario.semantics.assetDomReferences.forEach((reference, item) => { exactKeys(reference, ['path', 'selector', 'property', 'resolvedUrl', 'visibleArea', 'surface'], label + '.assetDomReference[' + String(item) + ']'); invariant(safeString(reference.path, 240) && safeString(reference.selector, 400) && ['src', 'background-image', 'mask-image'].includes(reference.property) && safeString(reference.resolvedUrl, 2000) && finite(reference.visibleArea, 64, 1000000) && reference.surface === 'game', label + ': asset DOM reference invalid or visually inert'); });
    invariant(Array.isArray(scenario.semantics.reviewAssetReferences) && scenario.semantics.reviewAssetReferences.length <= 20, label + ': review asset reference list invalid'); scenario.semantics.reviewAssetReferences.forEach((reference, item) => { exactKeys(reference, ['path', 'selector', 'property', 'resolvedUrl', 'visibleArea', 'surface'], label + '.reviewAssetReference[' + String(item) + ']'); invariant(safeString(reference.path, 240) && safeString(reference.selector, 400) && reference.property === 'src' && safeString(reference.resolvedUrl, 2000) && finite(reference.visibleArea, 64, 1000000) && reference.surface === 'review', label + ': reviewOnly asset is not visibly bound outside the GM'); });
    invariant(Array.isArray(scenario.semantics.dataBindings) && scenario.semantics.dataBindings.length <= 200, label + ': data-binding list invalid'); scenario.semantics.dataBindings.forEach((binding, item) => {
      const bindingKeys = ['id', 'text', 'visible', 'valueNow', 'valueMax', 'valueText', 'state', 'autoStatus', 'statusVersion', 'amountDecimal', 'screenId', 'ariaCurrent', 'ariaDisabled', 'nativeDisabled', 'reviewInteraction', 'applicationScope', 'targetEncounterId', 'screenUiState', 'objectiveCurrent', 'objectiveRequired', 'floorDecimal', 'eventId', 'eventType', 'simulationTick', 'stateVersion', 'sourceEntityId', 'targetEntityId', 'entityId', 'causeEventId', 'attackEventId', 'projectileEntityId', 'arrivalEventId', 'damageEventId', 'rewardEventId', 'settlementId', 'currencyCanonicalId', 'critical', 'defeatEventId', 'releaseEventId', 'releaseEventType', 'releaseSimulationTick', 'releaseStateVersion', 'releaseSourceEntityId', 'spawnEventId', 'spawnEventType', 'spawnSimulationTick', 'spawnStateVersion', 'spawnProjectileEntityId', 'spawnSourceEntityId', 'spawnTargetEntityId', 'spawnAttackEventId'];
      exactKeys(binding, bindingKeys, label + '.dataBinding[' + String(item) + ']');
      invariant(bindingKeys.filter((key) => key !== 'visible').every((key) => safeString(binding[key], key === 'text' ? 240 : key === 'targetEncounterId' ? 160 : 120)) && binding.visible === true, label + ': data-binding record invalid');
    });
    exactKeys(scenario.screenshot, ['path', 'width', 'height', 'bytes', 'sha256'], label + '.screenshot');
    const expectedPath = screenshotPrefix + expected.id + '-' + String(expected.width) + 'x' + String(expected.height) + '.png';
    invariant(scenario.screenshot.path === expectedPath && scenario.screenshot.width === expected.width && scenario.screenshot.height === expected.height && Number.isSafeInteger(scenario.screenshot.bytes) && /^sha256:[a-f0-9]{64}$/.test(scenario.screenshot.sha256), label + ': screenshot manifest mismatch');
  });
  if (expectsBrowserModes) {
    const modes = raw.browserModes;
    exactKeys(modes, ['viewport', 'gmSwitches', 'fitActual', 'referenceCompare', 'diagnostics'], 'browserModes');
    exactKeys(modes.viewport, ['width', 'height'], 'browserModes.viewport');
    invariant(modes.viewport.width === 390 && modes.viewport.height === 844, 'browserModes viewport mismatch');
    invariant(Array.isArray(modes.gmSwitches) && modes.gmSwitches.length === 8, 'browserModes GM switch count mismatch');
    const nominalByGm = new Map([['GM01', [390, 844]], ['GM02', [320, 667]], ['GM03', [375, 667]], ['GM04', [320, 568]], ['GM05', [430, 932]], ['GM06', [390, 844]], ['GM07', [390, 844]], ['GM08', [390, 844]]]);
    modes.gmSwitches.forEach((entry, index) => {
      const gm = `GM0${String(index + 1)}`;
      exactKeys(entry, ['requested', 'routePath', 'routeSearch', 'stageGm', 'fixtureId', 'layoutViewport', 'responsiveEvidenceOverride', 'selectedAriaCurrent', 'reviewId', 'ready', 'stageLayout', 'gameUiLayout', 'battlefieldLayout'], 'browserModes.gmSwitch[' + String(index) + ']');
      const nominal = nominalByGm.get(gm); const layoutKeys = ['width', 'height', 'scrollWidth', 'scrollHeight'];
      for (const [geometryName, geometry] of [['stageLayout', entry.stageLayout], ['gameUiLayout', entry.gameUiLayout], ['battlefieldLayout', entry.battlefieldLayout]]) { exactKeys(geometry, layoutKeys, 'browserModes.' + geometryName); invariant(layoutKeys.every((key) => Number.isSafeInteger(geometry[key]) && geometry[key] >= 0 && geometry[key] <= 10000), 'browserModes geometry invalid'); }
      const viewportContract = responsiveByViewport.get(`${nominal[0]}x${nominal[1]}`);
      invariant(entry.requested === gm && entry.routePath === '/step4/s02/golden-master-p1/' && entry.routeSearch === `?gm=${gm}` && entry.stageGm === gm && entry.fixtureId === `s02.p1.fixture.${gm}` && entry.layoutViewport === `${nominal[0]}x${nominal[1]}` && entry.responsiveEvidenceOverride === '' && entry.selectedAriaCurrent === 'page' && entry.reviewId === gm && entry.ready === 'true'
        && entry.stageLayout.width === nominal[0] && entry.stageLayout.height === nominal[1] && entry.gameUiLayout.width === nominal[0] && entry.gameUiLayout.height >= nominal[1] && entry.gameUiLayout.height <= nominal[1] + 44 && entry.battlefieldLayout.height >= viewportContract.battlefieldMinimumCssPx,
      'browserModes GM switch did not reach exact nominal container geometry');
    });
    exactKeys(modes.fitActual, ['fitBefore', 'actual', 'fitAfter'], 'browserModes.fitActual');
    const validateViewMode = (entry, label) => { exactKeys(entry, ['actualSizeClass', 'fitAriaPressed', 'actualAriaPressed', 'nominalWidth', 'nominalHeight', 'reviewSizing', 'reviewScale', 'viewportReadout', 'reviewTransform', 'reviewMatrixScaleX', 'stageRect'], label); invariant(typeof entry.actualSizeClass === 'boolean' && ['true', 'false'].includes(entry.fitAriaPressed) && ['true', 'false'].includes(entry.actualAriaPressed) && entry.nominalWidth === '430px' && entry.nominalHeight === '932px' && safeString(entry.reviewSizing, 40) && safeString(entry.reviewScale, 40) && safeString(entry.viewportReadout, 240) && safeString(entry.reviewTransform, 240) && finite(entry.reviewMatrixScaleX, 0.01, 4), label + ': state metadata invalid'); validateRect(entry.stageRect, label + '.stageRect'); };
    validateViewMode(modes.fitActual.fitBefore, 'browserModes.fitBefore'); validateViewMode(modes.fitActual.actual, 'browserModes.actual'); validateViewMode(modes.fitActual.fitAfter, 'browserModes.fitAfter');
    invariant(modes.fitActual.fitBefore.actualSizeClass === false && modes.fitActual.fitBefore.fitAriaPressed === 'true' && modes.fitActual.fitBefore.actualAriaPressed === 'false' && modes.fitActual.fitBefore.reviewSizing === 'FIT_WIDTH' && Number(modes.fitActual.fitBefore.reviewScale) < 1 && Math.abs(modes.fitActual.fitBefore.reviewMatrixScaleX - Number(modes.fitActual.fitBefore.reviewScale)) <= 0.000001 && Math.abs(modes.fitActual.fitBefore.stageRect.width - 390) <= 0.02 && /設計 430 × 932 CSS px/.test(modes.fitActual.fitBefore.viewportReadout), 'browserModes initial fit state invalid');
    invariant(modes.fitActual.actual.actualSizeClass === true && modes.fitActual.actual.fitAriaPressed === 'false' && modes.fitActual.actual.actualAriaPressed === 'true' && modes.fitActual.actual.reviewSizing === 'ACTUAL_1_TO_1' && modes.fitActual.actual.reviewScale === '1.000000' && modes.fitActual.actual.reviewMatrixScaleX === 1 && Math.abs(modes.fitActual.actual.stageRect.width - 430) <= 0.01 && Math.abs(modes.fitActual.actual.stageRect.height - 932) <= 0.01 && /100%表示/.test(modes.fitActual.actual.viewportReadout), 'browserModes 1:1 state invalid');
    invariant(modes.fitActual.fitAfter.actualSizeClass === false && modes.fitActual.fitAfter.fitAriaPressed === 'true' && modes.fitActual.fitAfter.actualAriaPressed === 'false' && modes.fitActual.fitAfter.reviewSizing === 'FIT_WIDTH' && modes.fitActual.fitAfter.reviewScale === modes.fitActual.fitBefore.reviewScale && Math.abs(modes.fitActual.fitAfter.stageRect.width - 390) <= 0.02, 'browserModes restored fit state invalid');
    exactKeys(modes.referenceCompare, ['closedBefore', 'open', 'closedAfter'], 'browserModes.referenceCompare');
    const validateCompareMode = (entry, label) => { exactKeys(entry, ['comparingClass', 'singleAriaPressed', 'compareAriaPressed', 'referenceHidden', 'referenceRendered', 'referenceViewportVisible', 'referenceOutsideStage', 'referenceDecoded', 'surfaceScrollLeft'], label); invariant(['comparingClass', 'referenceHidden', 'referenceRendered', 'referenceViewportVisible', 'referenceOutsideStage', 'referenceDecoded'].every((key) => typeof entry[key] === 'boolean') && ['true', 'false'].includes(entry.singleAriaPressed) && ['true', 'false'].includes(entry.compareAriaPressed) && finite(entry.surfaceScrollLeft, 0, 10000), label + ': comparison state invalid'); };
    validateCompareMode(modes.referenceCompare.closedBefore, 'browserModes.compareClosedBefore'); validateCompareMode(modes.referenceCompare.open, 'browserModes.compareOpen'); validateCompareMode(modes.referenceCompare.closedAfter, 'browserModes.compareClosedAfter');
    const closedExact = (entry) => entry.comparingClass === false && entry.singleAriaPressed === 'true' && entry.compareAriaPressed === 'false' && entry.referenceHidden === true && entry.referenceRendered === false && entry.referenceViewportVisible === false && entry.referenceOutsideStage === true;
    invariant(closedExact(modes.referenceCompare.closedBefore) && closedExact(modes.referenceCompare.closedAfter), 'browserModes comparison close state invalid');
    invariant(modes.referenceCompare.open.comparingClass === true && modes.referenceCompare.open.singleAriaPressed === 'false' && modes.referenceCompare.open.compareAriaPressed === 'true' && modes.referenceCompare.open.referenceHidden === false && modes.referenceCompare.open.referenceRendered === true && modes.referenceCompare.open.referenceViewportVisible === true && modes.referenceCompare.open.referenceOutsideStage === true && modes.referenceCompare.open.referenceDecoded === true && modes.referenceCompare.open.surfaceScrollLeft > 0, 'browserModes reference compare open state invalid');
    exactKeys(modes.diagnostics, ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths', 'unexpectedResponses'], 'browserModes.diagnostics');
    for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths']) invariant(Array.isArray(modes.diagnostics[key]) && modes.diagnostics[key].length <= 200 && modes.diagnostics[key].every((entry) => safeString(entry, 2000)), 'browserModes diagnostics invalid ' + key);
    invariant(Array.isArray(modes.diagnostics.unexpectedResponses) && modes.diagnostics.unexpectedResponses.length === 0 && modes.diagnostics.consoleErrors.length === 0 && modes.diagnostics.pageErrors.length === 0 && modes.diagnostics.failedRequests.length === 0 && modes.diagnostics.externalResources.length === 0 && modes.diagnostics.resourcePaths.length > 0, 'browserModes diagnostics did not pass');
  }
  if (expectsOfflineVariants) {
    invariant(Array.isArray(raw.offlineVariants) && raw.offlineVariants.length === expectedOfflineViewStates.length, 'offline variant count mismatch');
    raw.offlineVariants.forEach((variant, index) => {
      const label = 'offlineVariants[' + String(index) + ']';
      exactKeys(variant, ['viewState', 'route', 'diagnostics', 'fixtureId', 'synthetic', 'notRuntime', 'screenUiState', 'gameUiInert', 'gameUiAriaHidden', 'dialog'], label);
      invariant(variant.viewState === expectedOfflineViewStates[index] && variant.fixtureId === 's02.p1.fixture.GM07' && variant.synthetic === 'true' && variant.notRuntime === 'true' && variant.screenUiState === 'RECONCILE' && variant.gameUiInert === true && variant.gameUiAriaHidden === 'true', label + ': fixture/screen boundary mismatch');
      exactKeys(variant.route, ['path', 'search', 'status', 'redirectCount'], label + '.route');
      invariant(variant.route.path === '/step4/s02/golden-master-p1/' && variant.route.search === '?' + new URLSearchParams({ gm: 'GM07', offline: variant.viewState }).toString() && variant.route.status === 200 && variant.route.redirectCount === 0, label + ': exact route mismatch');
      exactKeys(variant.diagnostics, ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths', 'unexpectedResponses'], label + '.diagnostics');
      for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths']) invariant(Array.isArray(variant.diagnostics[key]) && variant.diagnostics[key].length <= 100 && variant.diagnostics[key].every((entry) => safeString(entry, 2000)), label + ': diagnostics invalid ' + key);
      invariant(Array.isArray(variant.diagnostics.unexpectedResponses) && variant.diagnostics.unexpectedResponses.length <= 100, label + ': response diagnostics invalid');
      variant.diagnostics.unexpectedResponses.forEach((entry) => { exactKeys(entry, ['url', 'status'], label + '.response'); invariant(safeString(entry.url, 2000) && Number.isSafeInteger(entry.status), label + ': response invalid'); });
      exactKeys(variant.dialog, ['role', 'ariaModal', 'labelledBy', 'describedBy', 'title', 'stateLabel', 'description', 'elapsedSeconds', 'capSeconds', 'capDisplay', 'viewState', 'settlementId', 'statusVersion', 'retryCapability', 'semanticShape', 'amountRows', 'progress', 'actions', 'walletAmountDecimal', 'walletText'], label + '.dialog');
      const dialog = variant.dialog;
      invariant([dialog.role, dialog.ariaModal, dialog.labelledBy, dialog.describedBy, dialog.title, dialog.stateLabel, dialog.description, dialog.elapsedSeconds, dialog.capSeconds, dialog.capDisplay, dialog.viewState, dialog.settlementId, dialog.statusVersion, dialog.retryCapability, dialog.walletAmountDecimal, dialog.walletText].every((entry) => safeString(entry, 1000)), label + ': dialog string invalid');
      exactKeys(dialog.semanticShape, ['id', 'borderTopWidth', 'borderRightWidth', 'borderStyle', 'borderRadius', 'clipPath'], label + '.semanticShape');
      invariant([dialog.semanticShape.id, dialog.semanticShape.borderTopWidth, dialog.semanticShape.borderRightWidth, dialog.semanticShape.borderStyle, dialog.semanticShape.borderRadius, dialog.semanticShape.clipPath].every((entry) => safeString(entry, 500)), label + ': semantic shape invalid');
      invariant(Array.isArray(dialog.amountRows) && dialog.amountRows.length <= 4, label + ': amount row count invalid');
      dialog.amountRows.forEach((entry, rowIndex) => { exactKeys(entry, ['term', 'value', 'currencyCanonicalId', 'amountDecimal'], label + '.amount[' + String(rowIndex) + ']'); invariant([entry.term, entry.value, entry.currencyCanonicalId, entry.amountDecimal].every((value) => safeString(value, 240)), label + ': amount row invalid'); });
      exactKeys(dialog.progress, ['present', 'kind', 'role', 'ariaValueNow', 'ariaValueMax', 'progressRatioDecimal', 'fixtureClaimOnly', 'notRuntimeAuthority'], label + '.progress');
      invariant(typeof dialog.progress.present === 'boolean' && [dialog.progress.kind, dialog.progress.role, dialog.progress.ariaValueNow, dialog.progress.ariaValueMax, dialog.progress.progressRatioDecimal, dialog.progress.fixtureClaimOnly, dialog.progress.notRuntimeAuthority].every((entry) => safeString(entry, 120)), label + ': progress invalid');
      invariant(Array.isArray(dialog.actions) && dialog.actions.length >= 1 && dialog.actions.length <= 3, label + ': action count invalid');
      dialog.actions.forEach((entry, actionIndex) => { exactKeys(entry, ['kind', 'label', 'enabled', 'priority'], label + '.action[' + String(actionIndex) + ']'); invariant(['close', 'retry', 'continue'].includes(entry.kind) && safeString(entry.label, 120) && typeof entry.enabled === 'boolean' && ['primary', 'secondary'].includes(entry.priority), label + ': action invalid'); });
    });
  }
  if (requestDefinitions) {
    invariant(Array.isArray(raw.requestMeasurements) && raw.requestMeasurements.length === requestDefinitions.length, 'raw request measurement count mismatch');
    raw.requestMeasurements.forEach((entry, index) => {
      const definition = requestDefinitions[index];
      const allowAbsent = options.allowAbsentIntroductions === true && options.currentRequestIds?.has(definition.requestId) && ['TEXT_EXACT', 'ELEMENT_VISIBLE'].includes(definition.type);
      validateRequestMeasurement(entry, definition, 'raw.requestMeasurement[' + String(index) + ']', allowAbsent);
    });
  }
  if (expectsAssetParticipation) validateAssetParticipation(raw.assetParticipation, 'raw.assetParticipation');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const dl = Math.abs(estimate - left); const du = Math.abs(estimate - up); const dul = Math.abs(estimate - upperLeft);
  return dl <= du && dl <= dul ? left : du <= dul ? up : upperLeft;
}

function decodePng(bytes, expectedWidth, expectedHeight, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  invariant(bytes.length >= 20 * 1024 && bytes.length <= 8 * 1024 * 1024, label + ': compressed size outside reviewed bounds');
  invariant(bytes.subarray(0, 8).equals(signature), label + ': PNG signature invalid');
  let offset = 8; let width; let height; let colorType; let seenIhdr = false; let seenIdat = false; let endedIdat = false; let seenIend = false; const idat = [];
  while (offset < bytes.length) {
    invariant(offset + 12 <= bytes.length, label + ': truncated PNG chunk');
    const length = bytes.readUInt32BE(offset); const typeBytes = bytes.subarray(offset + 4, offset + 8); const type = typeBytes.toString('ascii'); const dataStart = offset + 8; const dataEnd = dataStart + length;
    invariant(length <= 8 * 1024 * 1024 && dataEnd + 4 <= bytes.length, label + ': PNG chunk outside bounds');
    const data = bytes.subarray(dataStart, dataEnd);
    invariant(crc32(Buffer.concat([typeBytes, data])) === bytes.readUInt32BE(dataEnd), label + ': PNG ' + type + ' CRC mismatch');
    if (!seenIhdr) {
      invariant(type === 'IHDR' && length === 13, label + ': first PNG chunk is not IHDR'); seenIhdr = true;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); const bitDepth = data[8]; colorType = data[9];
      invariant(width === expectedWidth && height === expectedHeight && bitDepth === 8 && [0, 2, 4, 6].includes(colorType), label + ': PNG dimensions/format mismatch');
      invariant(data[10] === 0 && data[11] === 0 && data[12] === 0, label + ': unsupported PNG methods');
    } else if (type === 'IHDR') invariant(false, label + ': duplicate IHDR');
    else if (type === 'IDAT') { invariant(!endedIdat && !seenIend, label + ': non-contiguous IDAT'); seenIdat = true; idat.push(data); }
    else if (type === 'IEND') { invariant(seenIdat && !seenIend && length === 0, label + ': invalid IEND'); seenIend = true; }
    else { if (seenIdat) endedIdat = true; invariant((typeBytes[0] & 0x20) !== 0 || type === 'PLTE', label + ': unknown critical PNG chunk'); }
    offset = dataEnd + 4; if (seenIend) break;
  }
  invariant(seenIhdr && seenIdat && seenIend && offset === bytes.length, label + ': incomplete PNG or trailing bytes');
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]; const rowBytes = width * channels; const expectedInflated = height * (rowBytes + 1);
  const filtered = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflated });
  invariant(filtered.length === expectedInflated, label + ': inflated PNG length mismatch');
  const raw = Buffer.allocUnsafe(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (rowBytes + 1); const filter = filtered[sourceOffset]; invariant(filter <= 4, label + ': invalid PNG filter'); const targetOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = filtered[sourceOffset + 1 + x]; const left = x >= channels ? raw[targetOffset + x - channels] : 0; const up = y > 0 ? raw[targetOffset - rowBytes + x] : 0; const upperLeft = y > 0 && x >= channels ? raw[targetOffset - rowBytes + x - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      raw[targetOffset + x] = (encoded + predictor) & 0xff;
    }
  }
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels; const target = pixel * 4;
    if (colorType === 0) { rgba[target] = raw[source]; rgba[target + 1] = raw[source]; rgba[target + 2] = raw[source]; rgba[target + 3] = 255; }
    else if (colorType === 2) { rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; rgba[target + 3] = 255; }
    else if (colorType === 4) { rgba[target] = raw[source]; rgba[target + 1] = raw[source]; rgba[target + 2] = raw[source]; rgba[target + 3] = raw[source + 1]; }
    else { rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; rgba[target + 3] = raw[source + 3]; }
  }
  return { width, height, rgba };
}

function rounded(value) { return Number(value.toFixed(6)); }

function analyzePng(decoded) {
  const { width, height, rgba } = decoded; const count = width * height; let nonTransparent = 0; let nearOpaque = 0; let lumaSum = 0; let lumaSquared = 0; let edges = 0; let edgeSamples = 0; const buckets = new Map();
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4; const red = rgba[offset]; const green = rgba[offset + 1]; const blue = rgba[offset + 2]; const alpha = rgba[offset + 3];
    if (alpha > 0) nonTransparent += 1; if (alpha >= 250) nearOpaque += 1;
    const luma = (54 * red + 183 * green + 19 * blue) / 256; lumaSum += luma; lumaSquared += luma * luma;
    const bucket = String(red >> 4) + ':' + String(green >> 4) + ':' + String(blue >> 4); buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    if (pixel % width + 1 < width) { const adjacent = offset + 4; const adjacentLuma = (54 * rgba[adjacent] + 183 * rgba[adjacent + 1] + 19 * rgba[adjacent + 2]) / 256; if (Math.abs(luma - adjacentLuma) >= 12) edges += 1; edgeSamples += 1; }
  }
  const mean = lumaSum / count; const dominant = Math.max(...buckets.values());
  return { pixelCount: count, nonTransparentRatio: nonTransparent / count, nearOpaqueRatio: nearOpaque / count, quantizedColorCount: buckets.size, dominantColorRatio: dominant / count, lumaStdDev: Math.sqrt(Math.max(0, lumaSquared / count - mean * mean)), horizontalEdgeRatio: edgeSamples ? edges / edgeSamples : 0 };
}

function comparePng(left, right) {
  invariant(left.width === right.width && left.height === right.height, 'state comparison dimensions differ'); let changed = 0; let absolute = 0; const count = left.width * left.height;
  for (let pixel = 0; pixel < count; pixel += 1) { const offset = pixel * 4; let max = 0; for (let channel = 0; channel < 4; channel += 1) { const delta = Math.abs(left.rgba[offset + channel] - right.rgba[offset + channel]); max = Math.max(max, delta); absolute += delta; } if (max >= 12) changed += 1; }
  return { changedPixelRatio: changed / count, meanAbsoluteChannelDelta: absolute / (count * 4) };
}

function comparePngRegion(left, right, region) {
  invariant(left.width === right.width && left.height === right.height, 'ROI comparison dimensions differ');
  const startX = Math.floor(region.x * left.width); const startY = Math.floor(region.y * left.height);
  const endX = Math.ceil((region.x + region.width) * left.width); const endY = Math.ceil((region.y + region.height) * left.height);
  invariant(startX >= 0 && startY >= 0 && endX <= left.width && endY <= left.height && endX > startX && endY > startY, 'ROI pixel bounds invalid');
  let changed = 0; let absolute = 0; const count = (endX - startX) * (endY - startY);
  for (let y = startY; y < endY; y += 1) for (let x = startX; x < endX; x += 1) {
    const offset = (y * left.width + x) * 4; let maximum = 0;
    for (let channel = 0; channel < 4; channel += 1) { const delta = Math.abs(left.rgba[offset + channel] - right.rgba[offset + channel]); maximum = Math.max(maximum, delta); absolute += delta; }
    if (maximum >= 12) changed += 1;
  }
  return { changedPixelRatio: changed / count, meanAbsoluteChannelDelta: absolute / (count * 4) };
}

function comparisonPixelStats(stats) {
  return {
    nonTransparentRatio: stats.nonTransparentRatio,
    nearOpaqueRatio: stats.nearOpaqueRatio,
    quantizedColorCount: stats.quantizedColorCount,
    dominantColorRatio: stats.dominantColorRatio,
    lumaStdDev: stats.lumaStdDev,
    horizontalEdgeRatio: stats.horizontalEdgeRatio
  };
}

function passes(operator, value, threshold) {
  if (operator === 'EQUALS') return value === threshold;
  if (operator === 'GTE') return typeof value === 'number' && value >= threshold;
  if (operator === 'LTE') return typeof value === 'number' && value <= threshold;
  return operator === 'BETWEEN' && typeof value === 'number' && value >= threshold[0] && value <= threshold[1];
}

const findingAssertions = [];
function assertion(id, value) {
  const [operator, threshold, unit] = criteria[id]; const status = passes(operator, value, threshold) ? 'PASS' : 'FAIL';
  findingAssertions.push({ id, status, measurement: { value, operator, threshold, unit } });
  if (status === 'FAIL') failures.push(id + ': trusted recomputation failed');
}

const rawBytes = readBounded(rawPath, 16 * 1024 * 1024);
const raw = JSON.parse(rawBytes.toString('utf8'));
let baselineRawBytes = null;
let baselineRaw = null;
let affectedGoldenMasters = [];
let revisionLock = null;
let revisionContract = { definitions: [], assets: [] };
let requestedChangesSha256 = null;
let acceptanceCriteriaSha256 = null;
let priorCritic = null;
let currentRevisionRequestIds = new Set();
if (revisionMode) {
  let activeDefinitions = [];
  const lineageRequestIds = new Set();
  for (let stageIndex = 0; stageIndex <= activeRevisionIndex; stageIndex += 1) {
    const stage = revisionStages[stageIndex];
    const lock = parseJson(stage.lockPath, 2 * 1024 * 1024);
    invariant(lock.artifactId === stage.lockArtifactId && Array.isArray(lock.requestedChanges), `revision lock round ${stage.lockRound} identity mismatch`);
    const stageContract = validateRevisionContract(lock.requestedChanges);
    for (const definition of stageContract.definitions) definition.originStageIndex = stageIndex;
    for (const request of lock.requestedChanges) {
      invariant(!lineageRequestIds.has(request.id), request.id + ': request ID duplicated across revision lineage');
      lineageRequestIds.add(request.id);
    }
    const supersededAcrossStage = new Set();
    for (const request of lock.requestedChanges) for (const assertionId of request.supersedesAssertions) {
      invariant(!supersededAcrossStage.has(assertionId), assertionId + ': criterion superseded more than once in one lock');
      supersededAcrossStage.add(assertionId);
      const origin = activeDefinitions.find((definition) => definition.id === assertionId);
      invariant(Boolean(origin), assertionId + ': superseded criterion is not active in prior lineage');
      invariant(origin.originAffectedGoldenMasters.some((gm) => request.affectedGoldenMasters.includes(gm)) && origin.originTargetPaths.some((target) => request.targetPaths.includes(target)), assertionId + ': supersession is outside origin GM/target-path scope');
    }
    activeDefinitions = activeDefinitions.filter((definition) => !supersededAcrossStage.has(definition.id));
    for (const definition of stageContract.definitions) invariant(!activeDefinitions.some((active) => active.id === definition.id), definition.id + ': active criterion ID duplicated without supersession');
    activeDefinitions.push(...stageContract.definitions);
    if (stageIndex === activeRevisionIndex) {
      revisionLock = lock;
      revisionContract = { definitions: activeDefinitions, assets: stageContract.assets };
    }
  }
  requestedChangesSha256 = canonicalSha256(revisionLock.requestedChanges);
  currentRevisionRequestIds = new Set(revisionLock.requestedChanges.map((request) => request.id));
  acceptanceCriteriaSha256 = canonicalSha256(revisionContract.definitions.map((definition) => ({ requestId: definition.requestId, criterionSha256: definition.criterionSha256, assertion: definition.assertion })));
  affectedGoldenMasters = [...new Set(revisionLock.requestedChanges.flatMap((change) => change.affectedGoldenMasters))].sort();
  invariant(affectedGoldenMasters.length >= 1 && affectedGoldenMasters.every((id) => /^GM0[1-8]$/.test(id)), 'revision affected Golden Master union is invalid');
  priorCritic = parseJson(activeRevisionStage.priorCriticPath, 4 * 1024 * 1024);
  invariant(priorCritic.auditTarget && /^[a-f0-9]{40}$/.test(priorCritic.auditTarget.commit ?? '') && /^[a-f0-9]{40}$/.test(priorCritic.auditTarget.tree ?? ''), 'immediate-prior critic auditTarget is invalid');
}
const responsiveContract = parseJson(path.join(root, 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json'), 2 * 1024 * 1024);
const responsiveByViewport = new Map((responsiveContract.viewportContracts ?? []).map((contract) => [contract.viewport, contract]));
invariant(responsiveByViewport.size === 7 && ['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932'].every((viewport) => responsiveByViewport.has(viewport)), 'responsive contract does not bind all seven required viewport sizes');
validateRaw(raw, revisionMode ? { requestDefinitions: revisionContract.definitions, assetParticipation: true, offlineVariants: true, browserModes: true } : { offlineVariants: true, browserModes: true });
if (revisionMode) {
  baselineRawBytes = readBounded(baselineRawPath, 16 * 1024 * 1024);
  baselineRaw = JSON.parse(baselineRawBytes.toString('utf8'));
  validateRaw(baselineRaw, {
    scenarios: expectedScenarios.slice(0, 8),
    artifactId: `cats-tower-s02-golden-master-p1-browser-before-raw-round-${activeRevisionStage.evidenceRound}`,
    baseUrl: 'http://127.0.0.1:4174/step4/s02/golden-master-p1/',
    head: priorCritic.auditTarget.commit,
    tree: priorCritic.auditTarget.tree,
    screenshotPrefix: 'semantic-evidence/revision/before/',
    requestDefinitions: revisionContract.definitions,
    allowAbsentIntroductions: true,
    currentRequestIds: currentRevisionRequestIds
  });
}
const staticReport = parseJson(staticPath, 2 * 1024 * 1024);
exactKeys(staticReport, ['schemaVersion', 'artifactId', 'repository', 'branch', 'head', 'tree', 'checks', 'failures', 'verdict', 'physicalIPhoneVerified', 'productionMutationPerformed'], 'static report');
invariant(staticReport.schemaVersion === 2 && staticReport.artifactId === 'cats-tower-s02-golden-master-p1-static-evidence-round-002' && staticReport.repository === repository && staticReport.branch === branch && staticReport.head === raw.head && staticReport.tree === raw.tree, 'static report identity mismatch');
invariant(staticReport.verdict === 'PASS_S02_GOLDEN_MASTER_P1_STATIC' && Array.isArray(staticReport.failures) && staticReport.failures.length === 0 && Array.isArray(staticReport.checks), 'static report did not pass');
const staticCheckEntries = [];
const staticCheckIds = new Set();
for (const entry of staticReport.checks) {
  exactKeys(entry, ['id', 'value', 'evidence'], 'static check');
  invariant(typeof entry.id === 'string' && !staticCheckIds.has(entry.id), 'static check duplicate');
  staticCheckIds.add(entry.id);
  staticCheckEntries.push([entry.id, entry.value]);
}
const staticChecks = new Map(staticCheckEntries);
const assetManifest = parseJson(path.join(root, 'step4/s02/golden-master-p1/asset-manifest.json'), 2 * 1024 * 1024);
const reviewManifest = parseJson(path.join(root, 'step4/s02/golden-master-p1/review-manifest.json'), 2 * 1024 * 1024);
const acceptanceMatrix = parseJson(path.join(root, 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-001.json'), 4 * 1024 * 1024);
const dataBindingMatrix = parseJson(path.join(root, 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-data-binding-matrix.json'), 2 * 1024 * 1024);
const canonicalBindingIds = new Set((dataBindingMatrix.bindings ?? []).map((binding) => binding.id));
const assetKinds = new Map((assetManifest.assets ?? []).map((asset) => [asset.path, asset.kind]));
const assetRecords = new Map((assetManifest.assets ?? []).map((asset) => [asset.path, asset]));
const manifestAssetPaths = (assetManifest.assets ?? []).map((asset) => asset.path).sort();
const allowedBrowserResourcePaths = new Set(['/step4/s02/golden-master-p1/', '/step4/s02/golden-master-p1/review-manifest.json', ...(reviewManifest.routeFiles ?? []).map((entry) => '/' + entry.path)]);
const manifestFrameKeys = (assetManifest.assets ?? []).flatMap((asset) => (asset.frames ?? []).map((frame) => asset.path + '#' + frame.id)).sort();
const byId = new Map(raw.scenarios.map((scenario) => [scenario.id, scenario]));
const fixtureByGm = new Map((acceptanceMatrix.reviewFixtures ?? []).map((fixture) => [fixture.goldenMasterId, fixture]));
const gm05AntiBloatContract = responsiveByViewport.get('430x932')?.antiBloat;
invariant(gm05AntiBloatContract?.reference === 'GM01 390x844'
  && JSON.stringify(gm05AntiBloatContract.components) === JSON.stringify(['.game-hud', '.resource-chip', '.primary-action', '.nav-button'])
  && gm05AntiBloatContract.computedFontSizeToleranceCssPx === 0.01 && gm05AntiBloatContract.heightMaximumAdditiveCssPx === 4 && gm05AntiBloatContract.heightMaximumRatio === 1.1,
'responsive GM05 anti-bloat numeric contract mismatch');
invariant(fixtureByGm.size === 8, 'Acceptance matrix does not provide eight unique review fixtures');
const canonicalAssetEvidence = JSON.stringify(raw.scenarios[0].assets);
invariant(JSON.stringify(raw.scenarios[0].assets.map((asset) => asset.path + '#' + asset.frameId).sort()) === JSON.stringify(manifestFrameKeys), 'decoded browser frame graph differs from exact manifest sourceRect graph');
for (const scenario of raw.scenarios) {
  const frameKeys = scenario.assets.map((asset) => asset.path + '#' + asset.frameId);
  invariant(new Set(frameKeys).size === frameKeys.length, scenario.id + ': duplicate decoded asset frame evidence');
  invariant(JSON.stringify(scenario.assets) === canonicalAssetEvidence, scenario.id + ': decoded asset evidence changed between UI states');
  for (const evidence of scenario.assets) {
    const manifestAsset = assetRecords.get(evidence.path);
    const manifestFrame = manifestAsset?.frames?.find((frame) => frame.id === evidence.frameId);
    invariant(Boolean(manifestAsset) && Boolean(manifestFrame), scenario.id + ': decoded frame is absent from the exact manifest graph');
    invariant(evidence.naturalWidth === manifestAsset.width && evidence.naturalHeight === manifestAsset.height, scenario.id + ': decoded natural dimensions differ from the exact manifest for ' + evidence.path);
    invariant(JSON.stringify(evidence.sourceRect) === JSON.stringify(manifestFrame.sourceRect), scenario.id + ': decoded sourceRect differs from the exact manifest for ' + evidence.path + '#' + evidence.frameId);
    invariant(JSON.stringify(evidence.alphaBounds) === JSON.stringify({ left: manifestFrame.visibleBounds.x, top: manifestFrame.visibleBounds.y, right: manifestFrame.visibleBounds.x + manifestFrame.visibleBounds.width, bottom: manifestFrame.visibleBounds.y + manifestFrame.visibleBounds.height, width: manifestFrame.visibleBounds.width, height: manifestFrame.visibleBounds.height }), scenario.id + ': decoded threshold/component-filtered alpha bounds differ from manifest visibleBounds for ' + evidence.path + '#' + evidence.frameId);
  }
}
const primaryGoldenMasterScenarios = raw.scenarios.slice(0, 8);
for (const scenario of primaryGoldenMasterScenarios) {
  const fixture = fixtureByGm.get(scenario.gm);
  invariant(fixture?.fixtureId === scenario.document.fixtureId && fixture.synthetic === true && fixture.notRuntime === true && JSON.stringify(fixture.watermark) === JSON.stringify(['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME']), scenario.id + ': browser DOM does not bind the exact canonical review fixture');
  invariant(JSON.stringify(scenario.elements.cats.filter((cat) => cat.visible).map((cat) => cat.canonicalId)) === JSON.stringify(fixture.party.filter((entry) => entry.battlefield === true).map((entry) => entry.characterId)) && scenario.elements.enemy?.canonicalId === fixture.enemy.entityId, scenario.id + ': rendered battlefield entity IDs differ from the canonical fixture');
  invariant(scenario.elements.partyStates.length === fixture.party.length && scenario.elements.partyStates.every((state, index) => state.canonicalId === fixture.party[index].characterId && state.state === fixture.party[index].state && state.text.includes(fixture.party[index].name) && state.text.includes(fixture.party[index].stateDisplay)), scenario.id + ': rendered party identity/state differs from the canonical fixture');
  for (const reference of scenario.semantics.assetDomReferences) {
    invariant(assetKinds.has(reference.path), scenario.id + ': ordinary DOM references an asset outside the exact manifest');
    invariant(assetRecords.get(reference.path)?.reviewOnly === false && assetKinds.get(reference.path) !== 'reference' && reference.surface === 'game', scenario.id + ': reviewOnly/reference asset leaked into the GM stage');
    invariant(reference.selector === `[data-asset-path="${reference.path}"]`, scenario.id + ': asset reference selector is not the exact ordinary data-asset-path element');
    invariant(reference.resolvedUrl === new URL(reference.path, baseUrl).href, scenario.id + ': visible asset resolved URL differs from its exact manifest path');
    invariant(scenario.diagnostics.resourcePaths.includes('/step4/s02/golden-master-p1/' + reference.path), scenario.id + ': visible asset did not participate in the browser resource graph');
  }
  for (const reference of scenario.semantics.reviewAssetReferences) {
    invariant(assetRecords.get(reference.path)?.reviewOnly === true && assetKinds.get(reference.path) === 'reference' && reference.surface === 'review', scenario.id + ': review reference kind/surface mismatch');
    invariant(scenario.diagnostics.resourcePaths.includes('/step4/s02/golden-master-p1/' + reference.path), scenario.id + ': review reference did not load in ordinary review chrome');
    invariant(reference.resolvedUrl === new URL(reference.path, baseUrl).href, scenario.id + ': review reference resolved URL differs from its exact manifest path');
  }
  const bindingIds = new Set(scenario.semantics.dataBindings.map((binding) => binding.id));
  invariant([...bindingIds].every((id) => canonicalBindingIds.has(id)), scenario.id + ': ordinary DOM contains a data-binding outside the canonical matrix');
  const commonBindings = ['screen.uiState', 'tower.floor', 'encounter.identity', 'encounter.objective', 'enemy.hp', 'battle.autoState', 'party.slotIdentity', 'party.slotState', 'party.allyHp', 'party.fieldEntity', 'wallet.runCoin', 'support.shopDelivery', 'navigation.primary', 'navigation.bottom'];
  invariant(commonBindings.every((id) => bindingIds.has(id)), scenario.id + ': ordinary DOM omits a required common canonical data-binding');
  if (scenario.id === 'GM06') invariant(['combat.attack', 'combat.damage', 'combat.hit', 'combat.defeat', 'reward.feedback'].every((id) => bindingIds.has(id)), 'GM06 omits attack/damage/hit/defeat/reward canonical data-binding evidence');
  if (scenario.id === 'GM07') invariant(['offline.elapsed', 'offline.progress', 'offline.outcome', 'settlement.status'].every((id) => bindingIds.has(id)), 'GM07 omits offline/settlement canonical data-binding evidence');
  const floorBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'tower.floor');
  const screenStateBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'screen.uiState');
  const enemyHpBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'enemy.hp');
  const encounterBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'encounter.identity');
  const autoBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'battle.autoState');
  const expectedEnemyCurrent = fixture.enemy.hpCurrentDecimal ?? fixture.enemy.hpAfterDecimal;
  const expectedEnemyDisplay = fixture.enemy.hpDisplay ?? fixture.enemy.hpDisplayAtCapture;
  invariant(floorBinding?.text === fixture.header.floorDisplay && scenario.semantics.areaDisplay === fixture.header.areaDisplay, scenario.id + ': rendered floor/area differs from the canonical fixture');
  invariant(encounterBinding?.text.includes(fixture.enemy.displayName) && scenario.elements.enemy?.canonicalKind === fixture.enemy.kind, scenario.id + ': rendered enemy identity/kind differs from the canonical fixture');
  invariant(autoBinding?.autoStatus === fixture.header.autoStatus && autoBinding.text.replace(/\s+/g, '') === fixture.header.autoDisplay.replace(/\s+/g, ''), scenario.id + ': rendered AUTO state differs from the canonical fixture');
  invariant(screenStateBinding?.screenUiState === (scenario.id === 'GM07' ? 'RECONCILE' : 'READY'), scenario.id + ': rendered screen UI state differs from the canonical fixture state');
  invariant(enemyHpBinding?.valueNow === expectedEnemyCurrent && enemyHpBinding?.valueMax === fixture.enemy.hpMaxDecimal && enemyHpBinding?.valueText === expectedEnemyDisplay, scenario.id + ': rendered enemy HP differs from the canonical fixture');
  const allyHpBindings = scenario.semantics.dataBindings.filter((binding) => binding.id === 'party.allyHp');
  const expectedFieldParty = fixture.party.filter((entry) => entry.battlefield === true);
  invariant(allyHpBindings.length === expectedFieldParty.length && allyHpBindings.every((binding, index) => binding.valueNow === fixture.partyHpByCharacter[expectedFieldParty[index].characterId]?.currentDecimal && binding.valueMax === fixture.partyHpByCharacter[expectedFieldParty[index].characterId]?.maxDecimal), scenario.id + ': rendered field-party HP differs from the canonical fixture');
  const supportBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'support.shopDelivery');
  const walletBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'wallet.runCoin');
  const objectiveBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'encounter.objective');
  const primaryActionBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'navigation.primary');
  const navBindings = scenario.semantics.dataBindings.filter((binding) => binding.id === 'navigation.bottom');
  invariant(supportBinding?.state === fixture.support.summaryState && supportBinding.applicationScope === fixture.support.applicationScope && supportBinding.targetEncounterId === fixture.support.targetEncounterId && /次戦支援/.test(supportBinding.text) && /商会配送/.test(supportBinding.text) && /適用予定/.test(supportBinding.text), scenario.id + ': rendered support does not preserve exact scheduled next-battle causality');
  invariant(walletBinding?.amountDecimal === fixture.header.runCoinAmountDecimal && walletBinding?.text.includes(fixture.header.runCoinDisplay), scenario.id + ': rendered run coin differs from the canonical fixture');
  invariant(scenario.semantics.currencies.length === 1 && scenario.semantics.currencies[0].includes(fixture.header.runCoinDisplay) && scenario.semantics.ranks.length === 0, scenario.id + ': rendered currencies/ranks are not a one-to-one fixture projection');
  invariant(safeString(objectiveBinding?.text, 240) && objectiveBinding.text.length > 0, scenario.id + ': rendered objective binding is empty');
  if (!Object.hasOwn(fixture.enemy, 'threat')) invariant(!bindingIds.has('enemy.threat') && !/後衛狙い|前衛狙い|範囲攻撃予告|詠唱予告/.test(scenario.document.gameUiText), scenario.id + ': rendered an enemy threat/telegraph absent from the canonical fixture');
  const primaryOperabilityPass = scenario.state === 'offline'
    ? !scenario.elements.controls.some((control) => control.label === fixture.primaryAction.label)
    : scenario.elements.controls.some((control) => control.importance === 'primary' && control.label === fixture.primaryAction.label);
  invariant(primaryActionBinding?.text.includes(fixture.primaryAction.label) && primaryActionBinding.screenId === fixture.primaryAction.expectedScreenId && primaryActionBinding.reviewInteraction === fixture.primaryAction.reviewInteraction && primaryOperabilityPass, scenario.id + ': rendered primary action differs from the canonical fixture label/destination/review/inert boundary');
  invariant(navBindings.length === fixture.navigation.length && navBindings.every((binding, index) => {
    const expected = fixture.navigation[index];
    const stateMatches = expected.state === 'selected'
      ? binding.ariaCurrent === 'page' && binding.nativeDisabled === 'false'
      : expected.state === 'disabled'
        ? binding.ariaCurrent === '' && binding.nativeDisabled === 'true' && binding.ariaDisabled === 'true' && binding.text === expected.label
        : binding.ariaCurrent === '' && binding.nativeDisabled === 'false' && binding.ariaDisabled === '';
    return binding.text === expected.label && binding.screenId === (expected.screenId ?? '') && stateMatches;
  }), scenario.id + ': rendered bottom navigation identity/state differs from the canonical fixture');
  if (scenario.id === 'GM06') {
    const rewardBinding = scenario.semantics.dataBindings.find((binding) => binding.id === 'reward.feedback');
    invariant(rewardBinding?.state === 'provisional' && rewardBinding?.statusVersion === fixture.events.at(-1).statusVersion && /見込み/.test(rewardBinding.text), 'GM06 reward binding differs from the canonical provisional fixture');
  }
}
const participatingAssetPaths = [...new Set(primaryGoldenMasterScenarios.flatMap((scenario) => [...scenario.semantics.assetDomReferences, ...scenario.semantics.reviewAssetReferences].map((reference) => reference.path)))].sort();
invariant(JSON.stringify(participatingAssetPaths) === JSON.stringify(manifestAssetPaths), 'manifest includes unused assets or ordinary visible GM DOM omits a manifest asset');
if (revisionMode) {
  const requiredAssets = new Map(revisionContract.assets.map((entry) => [entry.path, entry]));
  invariant(JSON.stringify(raw.assetParticipation.map((entry) => entry.path)) === JSON.stringify([...requiredAssets.keys()]), 'revision asset participation does not cover the exact immutable required-asset graph');
  for (const assetPath of requiredAssets.keys()) invariant(assetRecords.has(assetPath), assetPath + ': required revision asset is absent from the exact manifest');
  for (const entry of raw.assetParticipation) {
    const owner = requiredAssets.get(entry.path);
    invariant(JSON.stringify(entry.requestIds) === JSON.stringify(owner?.requestIds ?? []), entry.path + ': request ownership mismatch');
    const manifestEntry = assetRecords.get(entry.path);
    invariant(Boolean(manifestEntry), entry.path + ': asset participation entry is absent from the exact manifest');
    invariant(JSON.stringify(entry.goldenMasters) === JSON.stringify([...new Set(entry.domReferences.map((reference) => reference.goldenMaster))].sort()), entry.path + ': participating GM set differs from real DOM references');
    const requiredSurface = manifestEntry.reviewOnly ? 'review' : 'game';
    if (owner) invariant(owner.goldenMasters.every((id) => entry.domReferences.some((reference) => reference.goldenMaster === id && reference.surface === requiredSurface)), entry.path + ': required asset does not visibly participate on the required surface in every affected GM');
    invariant(entry.domReferences.every((reference) => reference.surface === (manifestEntry.reviewOnly ? 'review' : 'game')), entry.path + ': asset participates on the wrong review/game surface');
    invariant(JSON.stringify(entry.requests.map((request) => request.goldenMaster)) === JSON.stringify(entry.goldenMasters), entry.path + ': browser request list differs from participating GMs');
    for (const request of entry.requests) {
      invariant(request.url === new URL(entry.path, baseUrl).href && request.status === 200 && /^image\/(?:webp|png|svg\+xml)(?:;|$)/i.test(request.contentType) && request.sha256 === 'sha256:' + manifestEntry.sha256 && request.decoded === true, entry.path + ': browser load/decode/MIME/digest evidence failed for ' + request.goldenMaster);
      const rawScenario = byId.get(request.goldenMaster);
      const references = manifestEntry.reviewOnly ? rawScenario.semantics.reviewAssetReferences : rawScenario.semantics.assetDomReferences;
      invariant(references.some((reference) => reference.path === entry.path && reference.resolvedUrl === request.url), entry.path + ': request has no exact ordinary DOM URL participation in ' + request.goldenMaster);
    }
  }
}

for (const scenario of raw.scenarios) {
  if (scenario.route.status !== 200 || scenario.route.redirectCount !== 0) failures.push(scenario.id + ': route is not direct HTTP 200');
  for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'unexpectedResponses']) if (scenario.diagnostics[key].length !== 0) failures.push(scenario.id + ': non-empty diagnostics ' + key);
  if (!scenario.diagnostics.resourcePaths.every((resourcePath) => allowedBrowserResourcePaths.has(resourcePath))) failures.push(scenario.id + ': browser resource escaped the exact review-manifest route graph');
  if (scenario.semantics.largeImageLayers.length < 1 || scenario.semantics.largeImageLayers.some((layer) => ['img', 'canvas', 'picture', 'video'].includes(layer.tagName) || layer.kind !== 'background' || assetKinds.get(layer.sourceAsset) !== 'background' || !layer.backgroundImage.includes(layer.sourceAsset))) failures.push(scenario.id + ': a large raster surface is not the single-purpose manifest background layer');
  if (scenario.document.ready !== 'true') failures.push(scenario.id + ': readiness marker missing');
  if (!scenario.document.bodyText.includes('DESIGN REVIEW') || !scenario.document.bodyText.includes('S02 GOLDEN MASTER') || !scenario.document.bodyText.includes('NOT RUNTIME')) failures.push(scenario.id + ': review boundary missing');
  if (!scenario.semantics.stageImages.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)) failures.push(scenario.id + ': a stage image did not decode');
}
for (const scenario of baselineRaw?.scenarios ?? []) {
  if (scenario.route.status !== 200 || scenario.route.redirectCount !== 0) failures.push('baseline ' + scenario.id + ': route is not direct HTTP 200');
  for (const key of ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'unexpectedResponses']) if (scenario.diagnostics[key].length !== 0) failures.push('baseline ' + scenario.id + ': non-empty diagnostics ' + key);
  if (!scenario.diagnostics.resourcePaths.every((resourcePath) => resourcePath.startsWith('/step4/s02/golden-master-p1/'))) failures.push('baseline ' + scenario.id + ': same-origin resource escaped the review route');
  if (scenario.document.ready !== 'true' || !scenario.document.bodyText.includes('DESIGN REVIEW') || !scenario.document.bodyText.includes('NOT RUNTIME')) failures.push('baseline ' + scenario.id + ': ordinary review boundary missing');
}

const decoded = new Map(); const pixelStats = []; const screenshots = [];
for (const scenario of raw.scenarios) {
  const target = path.join(root, scenario.screenshot.path); const bytes = readBounded(target, 8 * 1024 * 1024); const sha256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  invariant(bytes.length === scenario.screenshot.bytes && sha256 === scenario.screenshot.sha256, scenario.id + ': screenshot byte/digest mismatch');
  const image = decodePng(bytes, scenario.screenshot.width, scenario.screenshot.height, scenario.id); decoded.set(scenario.id, image); const stats = analyzePng(image);
  if (stats.nonTransparentRatio < 0.995 || stats.nearOpaqueRatio < 0.99 || stats.quantizedColorCount < 256 || stats.dominantColorRatio > 0.72 || stats.lumaStdDev < 18 || stats.horizontalEdgeRatio < 0.01) failures.push(scenario.id + ': screenshot pixel complexity/opacity gate failed');
  pixelStats.push({ id: scenario.id, path: scenario.screenshot.path, sha256, ...stats });
  screenshots.push({ id: scenario.id, viewport: scenario.viewport.label, path: scenario.screenshot.path, width: scenario.screenshot.width, height: scenario.screenshot.height, sha256 });
}
let revisionComparison = null;
let baselineRawSha256 = null;
let revisionComparisonSha256 = null;
if (revisionMode) {
  const baselineDecoded = new Map();
  const baselineStats = new Map();
  const revisionFailures = [];
  for (const scenario of baselineRaw.scenarios) {
    const target = path.join(root, scenario.screenshot.path);
    const bytes = readBounded(target, 8 * 1024 * 1024);
    const sha256 = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    invariant(bytes.length === scenario.screenshot.bytes && sha256 === scenario.screenshot.sha256, 'baseline ' + scenario.id + ': screenshot byte/digest mismatch');
    const image = decodePng(bytes, scenario.screenshot.width, scenario.screenshot.height, 'baseline ' + scenario.id);
    const stats = analyzePng(image);
    baselineDecoded.set(scenario.id, image);
    baselineStats.set(scenario.id, comparisonPixelStats(stats));
  }
  const affected = new Set(affectedGoldenMasters);
  const comparisons = baselineRaw.scenarios.map((beforeScenario) => {
    const id = beforeScenario.id;
    const afterScenario = byId.get(id);
    invariant(afterScenario, id + ': revised Golden Master is absent');
    const beforeStats = baselineStats.get(id);
    const afterStats = comparisonPixelStats(analyzePng(decoded.get(id)));
    const delta = comparePng(baselineDecoded.get(id), decoded.get(id));
    const isAffected = affected.has(id);
    const threshold = isAffected
      ? { changedPixelRatio: [0, 1], meanAbsoluteChannelDelta: [0, 255] }
      : { changedPixelRatio: [0, 0], meanAbsoluteChannelDelta: [0, 0] };
    const pass = delta.changedPixelRatio >= threshold.changedPixelRatio[0]
      && delta.changedPixelRatio <= threshold.changedPixelRatio[1]
      && delta.meanAbsoluteChannelDelta >= threshold.meanAbsoluteChannelDelta[0]
      && delta.meanAbsoluteChannelDelta <= threshold.meanAbsoluteChannelDelta[1]
      && (!isAffected || (beforeScenario.screenshot.sha256 !== afterScenario.screenshot.sha256 && (delta.changedPixelRatio > 0 || delta.meanAbsoluteChannelDelta > 0)));
    if (!pass) revisionFailures.push(id + ': same-run before/after pixel delta is outside its affected-state threshold');
    return {
      id,
      affected: isAffected,
      before: { path: beforeScenario.screenshot.path, sha256: beforeScenario.screenshot.sha256, pixelStats: beforeStats },
      after: { path: afterScenario.screenshot.path, sha256: afterScenario.screenshot.sha256, pixelStats: afterStats },
      delta,
      threshold,
      status: pass ? 'PASS' : 'FAIL'
    };
  });
  const changedGoldenMasters = comparisons.filter((entry) => entry.before.sha256 !== entry.after.sha256).map((entry) => entry.id).sort();
  if (JSON.stringify(changedGoldenMasters) !== JSON.stringify(affectedGoldenMasters)) revisionFailures.push('changed Golden Master digest set does not exactly equal the immutable user-decision union');
  const beforeMeasurements = new Map(baselineRaw.requestMeasurements.map((entry) => [entry.assertionId, entry]));
  const afterMeasurements = new Map(raw.requestMeasurements.map((entry) => [entry.assertionId, entry]));
  const activeRequestIds = [...new Set(revisionContract.definitions.map((definition) => definition.requestId))];
  const requestMeasurements = activeRequestIds.map((requestId) => {
    const assertions = revisionContract.definitions.filter((definition) => definition.requestId === requestId).map((definition) => {
      const before = beforeMeasurements.get(definition.id)?.observed;
      const after = afterMeasurements.get(definition.id)?.observed;
      invariant(before && after, definition.id + ': same-run raw measurement pair is absent');
      const currentCriterion = definition.originStageIndex === activeRevisionIndex;
      let measured; let pass = false;
      if (definition.type === 'DOM_RECT_DELTA') {
        const beforeValue = before.rect[definition.property]; const afterValue = after.rect[definition.property]; const delta = afterValue - beforeValue;
        measured = { beforeValue, afterValue, delta };
        pass = after.visible === true && (currentCriterion ? (definition.operator === 'DELTA_GTE' ? delta >= definition.threshold : definition.operator === 'DELTA_LTE' ? delta <= definition.threshold : Math.abs(delta) >= definition.threshold) : delta === 0);
      } else if (definition.type === 'DOM_STYLE_DELTA') {
        const numeric = ['font-size', 'opacity'].includes(definition.property);
        const beforeNumber = numeric ? Number.parseFloat(before.value) : null; const afterNumber = numeric ? Number.parseFloat(after.value) : null;
        const delta = numeric && Number.isFinite(beforeNumber) && Number.isFinite(afterNumber) ? afterNumber - beforeNumber : null;
        const changed = before.value !== after.value; const afterMatches = definition.operator === 'AFTER_EQUALS' ? after.value === definition.threshold : null;
        measured = { beforeValue: before.value, afterValue: after.value, delta, changed, afterMatches };
        if (!currentCriterion) pass = before.value === after.value;
        else if (definition.operator === 'DELTA_GTE') pass = delta !== null && delta >= definition.threshold;
        else if (definition.operator === 'DELTA_LTE') pass = delta !== null && delta <= definition.threshold;
        else if (definition.operator === 'ABS_DELTA_GTE') pass = delta !== null && Math.abs(delta) >= definition.threshold;
        else if (definition.operator === 'CHANGED') pass = changed;
        else pass = afterMatches === true && before.value !== definition.threshold;
        pass = after.visible === true && pass;
      } else if (definition.type === 'ROI_PIXEL_DELTA') {
        measured = comparePngRegion(baselineDecoded.get(definition.goldenMaster), decoded.get(definition.goldenMaster), definition.region);
        pass = currentCriterion
          ? measured.changedPixelRatio >= definition.changedPixelRatio[0] && measured.changedPixelRatio <= definition.changedPixelRatio[1]
            && measured.meanAbsoluteChannelDelta >= definition.meanAbsoluteChannelDelta[0] && measured.meanAbsoluteChannelDelta <= definition.meanAbsoluteChannelDelta[1]
          : measured.changedPixelRatio === 0 && measured.meanAbsoluteChannelDelta === 0;
      } else if (definition.type === 'TEXT_EXACT') {
        measured = { expected: definition.expected, beforeMatches: before.visible === true && before.text === definition.expected, afterMatches: after.visible === true && after.text === definition.expected, introducedOrChanged: before.selectorCount === 0 || before.visible !== true || before.text !== definition.expected };
        pass = after.visible === true && measured.afterMatches && (!currentCriterion || measured.introducedOrChanged);
      } else {
        measured = { minimumArea: definition.minimumArea, beforeVisibleArea: before.area, afterVisibleArea: after.area, introducedOrExpanded: before.selectorCount === 0 || before.visible !== true || before.area < definition.minimumArea };
        pass = after.visible === true && after.area >= definition.minimumArea && (!currentCriterion || measured.introducedOrExpanded);
      }
      if (!pass) revisionFailures.push(requestId + '/' + definition.id + ': immutable cumulative acceptance assertion failed');
      return { assertionId: definition.id, criterionSha256: definition.criterionSha256, type: definition.type, goldenMaster: definition.goldenMaster, before, after, measured, status: pass ? 'PASS' : 'FAIL' };
    });
    return { requestId, assertions, status: assertions.every((entry) => entry.status === 'PASS') ? 'PASS' : 'FAIL' };
  });
  baselineRawSha256 = 'sha256:' + createHash('sha256').update(baselineRawBytes).digest('hex');
  revisionComparison = {
    schemaVersion: 1,
    artifactId: `cats-tower-s02-golden-master-p1-revision-comparison-round-${activeRevisionStage.evidenceRound}`,
    repository,
    branch,
    baseline: { commit: baselineRaw.head, tree: baselineRaw.tree },
    revised: { commit: raw.head, tree: raw.tree },
    affectedGoldenMasters,
    requestedChangesSha256,
    acceptanceCriteriaSha256,
    comparisons,
    requestMeasurements,
    assetParticipation: raw.assetParticipation,
    verdict: revisionFailures.length === 0 ? 'PASS_S02_USER_REVISION_SAME_RUN_COMPARISON' : 'FAIL_S02_USER_REVISION_SAME_RUN_COMPARISON',
    failures: revisionFailures
  };
  fs.writeFileSync(revisionComparisonPath, JSON.stringify(revisionComparison, null, 2) + '\n');
  revisionComparisonSha256 = 'sha256:' + createHash('sha256').update(readBounded(revisionComparisonPath, 4 * 1024 * 1024)).digest('hex');
  failures.push(...revisionFailures.map((failure) => 'revision comparison: ' + failure));
}
const comparisonRules = [
  { left: 'GM01', right: 'GM06', changed: 0.03, delta: 2 },
  { left: 'GM01', right: 'GM07', changed: 0.08, delta: 4 },
  { left: 'GM01', right: 'GM08', changed: 0.08, delta: 4 }
];
const stateComparisons = comparisonRules.map((rule) => {
  const values = comparePng(decoded.get(rule.left), decoded.get(rule.right)); const pass = values.changedPixelRatio >= rule.changed && values.meanAbsoluteChannelDelta >= rule.delta;
  if (!pass) failures.push(rule.left + ' vs ' + rule.right + ': visual state delta too small');
  return { left: rule.left, right: rule.right, changedPixelRatio: values.changedPixelRatio, minimumChangedPixelRatio: rule.changed, meanAbsoluteChannelDelta: values.meanAbsoluteChannelDelta, minimumMeanAbsoluteChannelDelta: rule.delta, status: pass ? 'PASS' : 'FAIL' };
});
invariant(new Set(['GM01', 'GM06', 'GM07', 'GM08'].map((id) => byId.get(id).screenshot.sha256)).size === 4, 'four equal-size state screenshots are not unique');

function frameFor(scenario, unit) { return scenario.assets.find((asset) => asset.path === unit.sourceAsset && asset.frameId === unit.sourceFrameId); }
function intersects(rect, bounds, minimumRatio = 0.5) {
  if (!rect || !bounds || rect.width <= 0 || rect.height <= 0) return false;
  const width = Math.max(0, Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left));
  const height = Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top));
  return width * height >= rect.width * rect.height * minimumRatio;
}
function mappedUnit(scenario, unit) {
  const frame = frameFor(scenario, unit); if (!frame || !unit.artRect || !unit.preTransformRect || !unit.rect) return null;
  let scaleX;
  let scaleY;
  let frameLeft = unit.preTransformRect.left;
  let frameTop = unit.preTransformRect.top;
  let sourceMatchesRendering = unit.sourceAsset.length > 0 && unit.sourceFrameId.length > 0 && unit.visible === true && unit.opacity >= 0.5
    && intersects(unit.rect, scenario.elements.battlefield.rect, 0.65) && intersects(unit.artRect, scenario.elements.battlefield.rect, 0.65)
    && intersects(unit.rect, { left: 0, top: 0, right: scenario.viewport.width, bottom: scenario.viewport.height, width: scenario.viewport.width, height: scenario.viewport.height }, 0.9);
  if (unit.objectFit === 'contain') {
    scaleX = Math.min(unit.preTransformRect.width / frame.sourceRect.width, unit.preTransformRect.height / frame.sourceRect.height);
    scaleY = scaleX;
    const renderedAssetWidth = frame.naturalWidth * scaleX; const renderedAssetHeight = frame.naturalHeight * scaleY;
    frameLeft = unit.preTransformRect.left + (unit.preTransformRect.width - renderedAssetWidth) / 2 + frame.sourceRect.x * scaleX;
    frameTop = unit.preTransformRect.top + (unit.preTransformRect.height - renderedAssetHeight) / 2 + frame.sourceRect.y * scaleY;
    sourceMatchesRendering = sourceMatchesRendering && unit.sourceUrl.endsWith(unit.sourceAsset) && frame.sourceRect.x === 0 && frame.sourceRect.y === 0 && frame.sourceRect.width === frame.naturalWidth && frame.sourceRect.height === frame.naturalHeight;
  } else {
    const size = /^([0-9.]+)%\s+([0-9.]+)%$/.exec(unit.backgroundSize);
    const position = /^([0-9.]+)%\s+([0-9.]+)%$/.exec(unit.backgroundPosition);
    sourceMatchesRendering = sourceMatchesRendering && unit.backgroundImage.includes(unit.sourceAsset) && Boolean(size && position);
    if (size && position) {
      const renderedAssetWidth = unit.preTransformRect.width * Number(size[1]) / 100;
      const renderedAssetHeight = unit.preTransformRect.height * Number(size[2]) / 100;
      scaleX = renderedAssetWidth / frame.naturalWidth;
      scaleY = renderedAssetHeight / frame.naturalHeight;
      const shownX = -(unit.preTransformRect.width - renderedAssetWidth) * Number(position[1]) / 100 / scaleX;
      const shownY = -(unit.preTransformRect.height - renderedAssetHeight) * Number(position[2]) / 100 / scaleY;
      sourceMatchesRendering = sourceMatchesRendering
        && Math.abs(frame.sourceRect.width * scaleX - unit.preTransformRect.width) <= 1
        && Math.abs(frame.sourceRect.height * scaleY - unit.preTransformRect.height) <= 1
        && Math.abs(frame.sourceRect.x - shownX) <= 1
        && Math.abs(frame.sourceRect.y - shownY) <= 1;
    } else {
      scaleX = 0;
      scaleY = 0;
    }
  }
  const [a, b, c, d, e, f] = unit.transformMatrix;
  const transformDelta = Math.abs(Math.hypot(a, b) - Math.hypot(c, d)) / Math.max(Math.hypot(a, b), Math.hypot(c, d), 0.000001);
  const contentDelta = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY, 0.000001);
  const originTokens = unit.transformOrigin.split(/\s+/).map((token) => Number.parseFloat(token));
  const origin = { x: unit.preTransformRect.left + originTokens[0], y: unit.preTransformRect.top + originTokens[1] };
  const transformPoint = (point) => ({
    x: origin.x + a * (point.x - origin.x) + c * (point.y - origin.y) + e,
    y: origin.y + b * (point.x - origin.x) + d * (point.y - origin.y) + f
  });
  const footPoint = transformPoint({ x: frameLeft + frame.footAnchor.x * scaleX, y: frameTop + frame.footAnchor.y * scaleY });
  const hitCorners = [
    { x: frameLeft + frame.hitBounds.x * scaleX, y: frameTop + frame.hitBounds.y * scaleY },
    { x: frameLeft + (frame.hitBounds.x + frame.hitBounds.width) * scaleX, y: frameTop + frame.hitBounds.y * scaleY },
    { x: frameLeft + frame.hitBounds.x * scaleX, y: frameTop + (frame.hitBounds.y + frame.hitBounds.height) * scaleY },
    { x: frameLeft + (frame.hitBounds.x + frame.hitBounds.width) * scaleX, y: frameTop + (frame.hitBounds.y + frame.hitBounds.height) * scaleY }
  ].map(transformPoint);
  const hitCssBounds = { left: Math.min(...hitCorners.map((point) => point.x)), top: Math.min(...hitCorners.map((point) => point.y)), right: Math.max(...hitCorners.map((point) => point.x)), bottom: Math.max(...hitCorners.map((point) => point.y)) };
  hitCssBounds.width = hitCssBounds.right - hitCssBounds.left; hitCssBounds.height = hitCssBounds.bottom - hitCssBounds.top;
  const anchorMatches = Math.abs(unit.declaredFootAnchor.x - frame.footAnchor.x) <= 0.001 && Math.abs(unit.declaredFootAnchor.y - frame.footAnchor.y) <= 0.001
    && footPoint.x >= unit.rect.left - 1 && footPoint.x <= unit.rect.right + 1 && footPoint.y >= unit.rect.top - 1 && footPoint.y <= unit.rect.bottom + 1
    && hitCssBounds.left >= unit.artRect.left - 1 && hitCssBounds.right <= unit.artRect.right + 1 && hitCssBounds.top >= unit.artRect.top - 1 && hitCssBounds.bottom <= unit.artRect.bottom + 1;
  return { visibleHeight: frame.alphaBounds.height * scaleY, scaleDelta: Math.max(contentDelta, transformDelta), wrapperHeight: unit.rect.height, frame, sourceMatchesRendering, footPoint, hitCssBounds, anchorMatches };
}
const requiredViewportIds = ['GM04', 'GM02', 'GM03', 'RV360', 'GM01', 'RV412', 'GM05'];
const combatScenarios = requiredViewportIds.map((id) => byId.get(id));
const mappedCats = combatScenarios.flatMap((scenario) => scenario.elements.cats.filter((unit) => unit.visible).map((unit) => mappedUnit(scenario, unit)));
const mappedEnemies = combatScenarios.map((scenario) => scenario.elements.enemy && scenario.elements.enemy.visible ? mappedUnit(scenario, scenario.elements.enemy) : null).filter(Boolean);
const expectedMappedCatCount = combatScenarios.reduce((sum, scenario) => sum + scenario.elements.cats.filter((unit) => unit.visible).length, 0);
const expectedMappedEnemyCount = combatScenarios.filter((scenario) => scenario.elements.enemy?.visible).length;
const mappingComplete = mappedCats.length === expectedMappedCatCount && mappedEnemies.length === expectedMappedEnemyCount && expectedMappedCatCount > 0 && expectedMappedEnemyCount === combatScenarios.length && [...mappedCats, ...mappedEnemies].every((entry) => entry?.sourceMatchesRendering === true);
const catMinimum = mappingComplete ? Math.min(...mappedCats.map((entry) => entry.visibleHeight)) : 0;
const enemyMinimum = mappingComplete ? Math.min(...mappedEnemies.map((entry) => entry.visibleHeight)) : 0;
const maximumScaleDelta = mappingComplete ? Math.max(...mappedCats.concat(mappedEnemies).map((entry) => entry.scaleDelta)) : 1;
const anchorMappedUnits = raw.scenarios.flatMap((scenario) => [
  ...scenario.elements.cats.filter((unit) => unit.visible).map((unit) => mappedUnit(scenario, unit)),
  ...(scenario.elements.enemy?.visible ? [mappedUnit(scenario, scenario.elements.enemy)] : [])
]);
const anchorBindingPass = anchorMappedUnits.length > 0 && anchorMappedUnits.every((entry) => entry?.sourceMatchesRendering === true && entry.anchorMatches === true);
const standardScenarios = ['GM01', 'GM06', 'GM07', 'GM08'].map((id) => byId.get(id));
const standardCats = standardScenarios.flatMap((scenario) => scenario.elements.cats.filter((unit) => unit.visible).map((unit) => mappedUnit(scenario, unit)));
const standardEnemies = standardScenarios.map((scenario) => scenario.elements.enemy?.visible ? mappedUnit(scenario, scenario.elements.enemy) : null);
const standardPopulationComplete = standardScenarios.every((scenario) => scenario.elements.cats.filter((unit) => unit.visible).length === (scenario.id === 'GM08' ? 1 : 4)) && standardCats.every((entry) => entry?.sourceMatchesRendering) && standardEnemies.every((entry) => entry?.sourceMatchesRendering);
const standardCatMinimum = standardPopulationComplete ? Math.min(...standardCats.map((entry) => entry.visibleHeight)) : 0;
const standardEnemyMinimum = standardPopulationComplete ? Math.min(...standardEnemies.map((entry) => entry.visibleHeight)) : 0;

const visibleText = raw.scenarios.flatMap((scenario) => scenario.elements.meaningfulText.filter((entry) => entry.visible));
const primaryText = raw.scenarios.flatMap((scenario) => scenario.elements.primaryLabels.filter((entry) => entry.visible));
const visibleControls = raw.scenarios.flatMap((scenario) => scenario.elements.controls.filter((entry) => entry.visible));
const isPermittedMetadata = (entry) => entry.textRole === 'transient-metadata' && entry.transient === true && entry.interactiveAncestor === false;
const metadataText = visibleText.filter(isPermittedMetadata);
const meaningfulText = visibleText.filter((entry) => !isPermittedMetadata(entry));
const minimumMeaningfulText = meaningfulText.length ? Math.min(...meaningfulText.map((entry) => entry.fontSize)) : 0;
const minimumMetadataText = metadataText.length ? Math.min(...metadataText.map((entry) => entry.fontSize)) : 12;
const minimumPrimaryText = primaryText.length ? Math.min(...primaryText.map((entry) => entry.fontSize)) : 0;
const primaryControls = visibleControls.filter((entry) => entry.importance === 'primary');
const importantControls = visibleControls.filter((entry) => entry.importance === 'important');
const minimumPrimaryControl = primaryControls.length ? Math.min(...primaryControls.flatMap((entry) => [entry.rect?.width ?? 0, entry.rect?.height ?? 0])) : 0;
const minimumImportantControl = importantControls.length ? Math.min(...importantControls.flatMap((entry) => [entry.rect?.width ?? 0, entry.rect?.height ?? 0])) : 0;
const largeText = (entry) => entry.fontSize >= 24 || (entry.fontSize >= 18.66 && entry.fontWeight >= 700);
const textContrastPasses = (entry) => entry.backdropOpaque === true && entry.backdropImageFree === true && entry.contrastRatio !== null
  && entry.contrastRatio >= (largeText(entry) ? 3 : 4.5)
  && (!entry.disabledAncestor || entry.effectiveOpacity >= 0.999);
invariant(!textContrastPasses({ fontSize: 14, fontWeight: 400, backdropOpaque: true, backdropImageFree: true, contrastRatio: 4.49, disabledAncestor: false, effectiveOpacity: 1 })
  && !textContrastPasses({ fontSize: 14, fontWeight: 400, backdropOpaque: true, backdropImageFree: true, contrastRatio: 7, disabledAncestor: true, effectiveOpacity: 0.5 }), 'trusted contrast gate accepts a low-contrast or translucent disabled-text negative vector');
const contrastPass = visibleText.every(textContrastPasses);
const overlapArea = (left, right) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
const rectGap = (left, right) => Math.hypot(Math.max(0, left.left - right.right, right.left - left.right), Math.max(0, left.top - right.bottom, right.top - left.bottom));
function controlsFitAndDoNotOverlap(scenario, allowVerticalScroll = false) {
  const controls = scenario.elements.controls.filter((entry) => entry.visible && entry.rect);
  const stage = { left: 0, top: 0, right: scenario.viewport.width, bottom: scenario.viewport.height, width: scenario.viewport.width, height: scenario.viewport.height };
  const verticallyReachable = (entry) => entry.rect.top >= 0 && (entry.rect.bottom <= stage.bottom || (allowVerticalScroll && scenario.document.stageScroll.scrollHeight > scenario.document.stageScroll.clientHeight && entry.rect.bottom <= scenario.document.stageScroll.scrollHeight));
  const boundsPass = controls.filter((entry) => entry.importance === 'primary').length === 1 && controls.every((entry) => entry.rect.left >= 0 && entry.rect.right <= stage.right && verticallyReachable(entry)
    && entry.rect.width >= (entry.importance === 'primary' ? 48 : 44) && entry.rect.height >= (entry.importance === 'primary' ? 48 : 44));
  const overlaps = controls.some((entry, index) => controls.slice(index + 1).some((other) => overlapArea(entry.rect, other.rect) > 1));
  const gapsPass = controls.every((entry, index) => controls.slice(index + 1).every((other) => rectGap(entry.rect, other.rect) >= 8));
  return boundsPass && !overlaps && gapsPass;
}
invariant(!([{ importance: 'primary' }, { importance: 'primary' }].filter((entry) => entry.importance === 'primary').length === 1), 'trusted one-primary gate accepts a duplicate-primary negative vector');
const controlBoundsPass = raw.scenarios.every((scenario) => controlsFitAndDoNotOverlap(scenario, ['TEXT200', 'TEXT200SAFE', 'GM07C320TEXT200'].includes(scenario.id)));
const measuredControlGaps = raw.scenarios.flatMap((scenario) => {
  const controls = scenario.elements.controls.filter((entry) => entry.visible && entry.rect);
  return controls.flatMap((entry, index) => controls.slice(index + 1).map((other) => rectGap(entry.rect, other.rect)));
});
const minimumControlGap = measuredControlGaps.length > 0 ? Math.min(...measuredControlGaps) : 8;
const indicatorKinds = new Map(['disabled', 'locked', 'selected', 'hp'].map((kind) => [kind, raw.scenarios.flatMap((scenario) => scenario.elements.semanticIndicators.filter((entry) => entry.visible && entry.kind === kind))]));
const stateSemanticsPass = indicatorKinds.get('disabled').length > 0 && indicatorKinds.get('disabled').every((entry) => (entry.nativeDisabled || entry.ariaDisabled === 'true') && (entry.text.length > 0 || entry.ariaLabel.length > 0))
  && indicatorKinds.get('locked').length > 0 && indicatorKinds.get('locked').every((entry) => /未解放|ロック|locked/i.test(entry.text + ' ' + entry.ariaLabel))
  && indicatorKinds.get('selected').length > 0 && indicatorKinds.get('selected').every((entry) => entry.ariaCurrent === 'page' || entry.ariaSelected === 'true' || /選択|戦場参加中|selected/i.test(entry.text + ' ' + entry.ariaLabel))
  && indicatorKinds.get('hp').length > 0 && indicatorKinds.get('hp').every((entry) => entry.role === 'progressbar' && /^\d+(?:\.\d+)?$/.test(entry.ariaValueNow) && /^\d+(?:\.\d+)?$/.test(entry.ariaValueMax) && Number(entry.ariaValueMax) > 0 && (/[0-9]|HP|体力/i.test(entry.text + ' ' + entry.ariaLabel)));

const gm01 = byId.get('GM01'); const gm04 = byId.get('GM04'); const gm06 = byId.get('GM06'); const gm07 = byId.get('GM07'); const gm08 = byId.get('GM08'); const safe = byId.get('SAFE390'); const text200 = byId.get('TEXT200'); const gm07Compact = byId.get('GM07C320'); const gm07CompactText200 = byId.get('GM07C320TEXT200'); const text200Safe = byId.get('TEXT200SAFE');
const stageBounds = (scenario) => ({ left: 0, top: 0, right: scenario.viewport.width, bottom: scenario.viewport.height, width: scenario.viewport.width, height: scenario.viewport.height });
function scenarioLayoutPass(scenario) {
  const viewportContract = responsiveByViewport.get(`${scenario.viewport.width}x${scenario.viewport.height}`);
  const minBattle = viewportContract?.battlefieldMinimumCssPx ?? Number.POSITIVE_INFINITY;
  const stage = scenario.document.stage; const battlefield = scenario.elements.battlefield; const nav = scenario.elements.bottomNavigation;
  const cats = scenario.elements.cats.filter((unit) => unit.visible); const enemy = scenario.elements.enemy;
  const criticalNoClip = scenario.elements.criticalLabels.filter((entry) => entry.visible).every((entry) => entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1);
  return stage.width === scenario.viewport.width && stage.height === scenario.viewport.height && battlefield.visible && battlefield.rect.height >= minBattle && battlefield.rect.top >= 0 && battlefield.rect.bottom <= scenario.viewport.height
    && nav.visible && nav.rect.bottom >= scenario.viewport.height - 1 && nav.rect.bottom <= scenario.viewport.height + 1
    && cats.length === 4 && cats.every((unit) => (mappedUnit(scenario, unit)?.visibleHeight ?? 0) >= 60)
    && enemy?.visible && (mappedUnit(scenario, enemy)?.visibleHeight ?? 0) >= 80
    && criticalNoClip && scenario.document.stageScroll.scrollWidth <= scenario.document.stageScroll.clientWidth + 1;
}
const viewportPassCount = requiredViewportIds.filter((id) => scenarioLayoutPass(byId.get(id))).length;
const safeNavControls = safe.elements.controls.filter((entry) => entry.visible && entry.rect && entry.rect.top >= safe.elements.bottomNavigation.rect.top);
const safeCritical = safe.elements.criticalLabels.filter((entry) => entry.visible);
const safePass = JSON.stringify(safe.environment.safeAreaInsets) === JSON.stringify({ top: 24, right: 0, bottom: 34, left: 0 })
  && safe.elements.battlefield.rect.top >= gm01.elements.battlefield.rect.top + 20
  && safeCritical.length >= gm01.elements.criticalLabels.filter((entry) => entry.visible).length
  && safeCritical.every((entry) => entry.rect.top >= 24 && entry.rect.left >= 0 && entry.rect.right <= safe.viewport.width)
  && safe.elements.controls.filter((entry) => entry.visible && entry.rect).every((entry) => entry.rect.left >= 0 && entry.rect.right <= safe.viewport.width)
  && safeNavControls.length >= 5 && Math.max(...safeNavControls.map((entry) => entry.rect.bottom)) <= safe.viewport.height - 30;
const text200Critical = text200.elements.criticalLabels.filter((entry) => entry.visible);
const gm04Critical = gm04.elements.criticalLabels.filter((entry) => entry.visible);
const textKey = (entry) => [entry.text, entry.tagName, entry.className].join('|');
const text200ByText = new Map(text200Critical.map((entry) => [textKey(entry), entry]));
const text200Primary = text200.elements.primaryLabels.filter((entry) => entry.visible);
const gm04Primary = gm04.elements.primaryLabels.filter((entry) => entry.visible);
const text200PrimaryByText = new Map(text200Primary.map((entry) => [textKey(entry), entry]));
const gm04PrimaryControls = gm04.elements.controls.filter((entry) => entry.visible && entry.importance === 'primary');
const text200PrimaryControls = text200.elements.controls.filter((entry) => entry.visible && entry.importance === 'primary');
const controlKey = (entry) => [entry.label, entry.tagName, entry.role].join('|');
const text200PrimaryControlMap = new Map(text200PrimaryControls.map((entry) => [controlKey(entry), entry]));
const reachableAt200 = (rect) => rect && rect.left >= 0 && rect.right <= text200.viewport.width && rect.top >= 0 && (rect.bottom <= text200.viewport.height || (text200.document.stageScroll.scrollHeight > text200.document.stageScroll.clientHeight && rect.bottom <= text200.document.stageScroll.scrollHeight));
const noPairOverlap = (entries) => !entries.some((entry, index) => entries.slice(index + 1).some((other) => overlapArea(entry.rect, other.rect) > 1));
const navigationLabelsPass = (scenario) => {
  const probe = scenario.elements.navigationScrollProbe;
  const labels = (probe.performed ? probe.labelsAfter : scenario.elements.navigationLabels).filter((entry) => entry.visible);
  const controls = probe.performed ? probe.controlsAfter.filter((entry) => entry.visible) : [];
  const safeBottom = scenario.environment.safeAreaInsets.bottom ?? 0;
  const probePass = !probe.performed || (probe.scrollHeight > probe.clientHeight && probe.scrollTopAfter > probe.scrollTopInitial && probe.focusReached === true
    && probe.navRectAfter && probe.navRectAfter.top >= 0 && probe.navRectAfter.bottom <= scenario.viewport.height - safeBottom + 1
    && controls.length === 5 && controls.every((entry) => entry.rect.width >= 44 && entry.rect.height >= 48 && entry.rect.left >= 0 && entry.rect.right <= scenario.viewport.width && entry.rect.top >= 0 && entry.rect.bottom <= scenario.viewport.height - safeBottom + 1));
  return probePass && labels.length === 5 && labels.every((entry) => entry.lineHeight !== null && entry.lineHeight > 0
    && entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1
    && entry.rect.left >= 0 && entry.rect.right <= scenario.viewport.width && entry.rect.top >= 0 && entry.rect.bottom <= scenario.viewport.height - safeBottom + 1
    && entry.rect.height <= entry.lineHeight * 2 + 2) && noPairOverlap(labels);
};
const text200Pass = text200.environment.textScalePercent === 200 && Math.abs(text200.environment.rootFontSize - gm04.environment.rootFontSize * 2) <= 0.05
  && text200Critical.length === gm04Critical.length && gm04Critical.every((baseline) => text200ByText.has(textKey(baseline)) && Math.abs(text200ByText.get(textKey(baseline)).fontSize - baseline.fontSize * 2) <= 0.05)
  && text200Primary.length === gm04Primary.length && gm04Primary.every((baseline) => text200PrimaryByText.has(textKey(baseline)) && Math.abs(text200PrimaryByText.get(textKey(baseline)).fontSize - baseline.fontSize * 2) <= 0.05)
  && text200PrimaryControls.length === gm04PrimaryControls.length && gm04PrimaryControls.every((baseline) => text200PrimaryControlMap.has(controlKey(baseline)) && Math.abs(text200PrimaryControlMap.get(controlKey(baseline)).fontSize - baseline.fontSize * 2) <= 0.05)
  && text200Critical.every((entry) => entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1 && reachableAt200(entry.rect))
  && text200PrimaryControls.every((entry) => entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1 && entry.rect.width >= 48 && entry.rect.height >= 48 && reachableAt200(entry.rect))
  && noPairOverlap(text200Critical) && noPairOverlap(text200PrimaryControls) && controlsFitAndDoNotOverlap(text200, true) && navigationLabelsPass(text200)
  && text200.document.stageScroll.scrollHeight > text200.document.stageScroll.clientHeight && text200.elements.navigationScrollProbe.performed
  && text200.elements.battlefield.visible && intersects(text200.elements.battlefield.rect, stageBounds(text200), 0.5)
  && text200.elements.criticalLabels.some((entry) => entry.visible && entry.text.includes('26階') && intersects(entry.rect, stageBounds(text200), 0.5))
  && text200.elements.bottomNavigation.visible && text200.elements.partyDock.visible && text200.elements.support?.visible === true;
const text200SafeCritical = text200Safe.elements.criticalLabels.filter((entry) => entry.visible);
const text200SafePrimary = text200Safe.elements.primaryLabels.filter((entry) => entry.visible);
const gm04NavigationByText = new Map(gm04.elements.navigationLabels.filter((entry) => entry.visible).map((entry) => [entry.text, entry]));
const text200SafeNavigationByText = new Map(text200Safe.elements.navigationLabels.filter((entry) => entry.visible).map((entry) => [entry.text, entry]));
const text200SafeNavControls = text200Safe.elements.navigationScrollProbe.controlsAfter.filter((entry) => entry.visible);
const text200SafePass = JSON.stringify(text200Safe.environment.safeAreaInsets) === JSON.stringify({ top: 24, right: 0, bottom: 34, left: 0 })
  && text200Safe.environment.textScalePercent === 200 && Math.abs(text200Safe.environment.rootFontSize - gm04.environment.rootFontSize * 2) <= 0.05
  && text200SafeCritical.length === gm04Critical.length && gm04Critical.every((baseline) => text200SafeCritical.some((scaled) => textKey(scaled) === textKey(baseline) && Math.abs(scaled.fontSize - baseline.fontSize * 2) <= 0.05))
  && text200SafePrimary.length === gm04Primary.length && gm04Primary.every((baseline) => text200SafePrimary.some((scaled) => textKey(scaled) === textKey(baseline) && Math.abs(scaled.fontSize - baseline.fontSize * 2) <= 0.05))
  && gm04NavigationByText.size === 5 && text200SafeNavigationByText.size === 5 && [...gm04NavigationByText].every(([label, baseline]) => text200SafeNavigationByText.has(label) && Math.abs(text200SafeNavigationByText.get(label).fontSize - baseline.fontSize * 2) <= 0.05)
  && navigationLabelsPass(text200Safe) && controlsFitAndDoNotOverlap(text200Safe, true)
  && text200Safe.elements.navigationScrollProbe.performed && text200Safe.document.stageScroll.scrollHeight > text200Safe.document.stageScroll.clientHeight
  && text200SafeNavControls.length === 5 && text200SafeNavControls.every((control) => control.rect.bottom <= text200Safe.viewport.height - 30)
  && text200Safe.elements.navigationScrollProbe.labelsAfter.every((entry) => !entry.visible || entry.rect.bottom <= text200Safe.viewport.height - 30);
const gm04InitialPrimary = gm04.elements.controls.filter((entry) => entry.visible && entry.importance === 'primary');
const gm04Pass = gm04.elements.battlefield.visible && gm04.elements.battlefield.rect.height >= 300 && gm04.elements.bottomNavigation.visible
  && intersects(gm04.elements.battlefield.rect, stageBounds(gm04), 0.9) && intersects(gm04.elements.bottomNavigation.rect, stageBounds(gm04), 0.9)
  && gm04.elements.cats.filter((entry) => entry.visible && intersects(entry.rect, stageBounds(gm04), 0.9)).length === 4
  && gm04.elements.enemy?.visible === true && intersects(gm04.elements.enemy.rect, stageBounds(gm04), 0.9)
  && gm04InitialPrimary.length >= 1 && gm04InitialPrimary.every((entry) => intersects(entry.rect, stageBounds(gm04), 0.9))
  && gm04.elements.criticalLabels.filter((entry) => entry.visible && entry.text.includes('26階')).some((entry) => intersects(entry.rect, stageBounds(gm04), 0.9))
  && gm04.elements.criticalLabels.filter((entry) => entry.visible && intersects(entry.rect, stageBounds(gm04), 0.01)).every((entry) => entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1);
const noRuby = raw.scenarios.every((scenario) => !scenario.document.gameUiText.match(/ルビー|ruby/i));
const noRank = raw.scenarios.every((scenario) => !scenario.document.gameUiText.match(/RANK|ランク|\bR\d+\b/i));
function killConsistent(scenario) {
  const counter = /(\d+)\s*\/\s*(\d+)/.exec(scenario.semantics.killCounter); const objective = /(\d+)\s*\/\s*(\d+)/.exec(scenario.semantics.objective);
  const remaining = counter ? Number(counter[2]) - Number(counter[1]) : -1;
  return Boolean(counter && objective && counter[1] === objective[1] && counter[2] === objective[2] && remaining >= 0 && /階層制圧/.test(scenario.semantics.objective) && !/あと\s*\d+\s*体|27階|次階/.test(scenario.document.gameUiText));
}
const fixtureBindingPass = raw.scenarios.every((scenario) => {
  const fixture = fixtureByGm.get(scenario.gm); const header = fixture?.header;
  const objectiveBindings = scenario.semantics.dataBindings.filter((entry) => entry.id === 'encounter.objective');
  const floorBindings = scenario.semantics.dataBindings.filter((entry) => entry.id === 'tower.floor');
  return Boolean(header) && objectiveBindings.length >= 1 && objectiveBindings.every((entry) => entry.objectiveCurrent === header.objectiveCurrentDecimal && entry.objectiveRequired === header.objectiveRequiredDecimal && entry.text.includes(header.objectiveCurrentDecimal) && entry.text.includes(header.objectiveRequiredDecimal))
    && objectiveBindings.some((entry) => entry.text.replace(/\s+/g, '').includes(header.objectiveDisplay.replace(/\s+/g, '')))
    && floorBindings.length === 1 && floorBindings[0].floorDecimal === header.floorDecimal && floorBindings[0].text.includes(header.floorDisplay)
    && !/27階|次階/.test(scenario.document.gameUiText);
});
const rewardKinds = new Map(gm06.semantics.rewardStates.map((entry) => [entry.state, entry]));
const provisionalShapeMarker = gm06.elements.combatMarkers.find((entry) => entry.kind === 'reward-provisional');
const canonicalGm06Reward = fixtureByGm.get('GM06')?.events?.at(-1);
const canonicalGm06Fixture = fixtureByGm.get('GM06');
const gm06RewardBinding = gm06.semantics.dataBindings.find((entry) => entry.id === 'reward.feedback');
const gm06Counter = /(\d+)\s*\/\s*(\d+)/.exec(gm06.semantics.killCounter);
const gm06ObjectivePass = Boolean(gm06Counter) && gm06Counter[1] === canonicalGm06Fixture?.header?.objectiveCurrentDecimal && gm06Counter[2] === canonicalGm06Fixture?.header?.objectiveRequiredDecimal && !/あと\s*\d+\s*体/.test(gm06.semantics.objective) && /次階|準備|制圧/.test(gm06.semantics.objective);
const rewardTruthPass = canonicalGm06Reward?.status === 'provisional' && canonicalGm06Reward?.statusVersion === '1'
  && rewardKinds.get('provisional')?.visible === true && /見込み/.test(rewardKinds.get('provisional').text) && /9/.test(rewardKinds.get('provisional').text)
  && gm06RewardBinding?.state === canonicalGm06Reward.status && gm06RewardBinding?.statusVersion === canonicalGm06Reward.statusVersion && gm06RewardBinding?.amountDecimal === canonicalGm06Reward.amountDecimal
  && provisionalShapeMarker?.semanticShape === 'open-edge' && Number.parseFloat(provisionalShapeMarker.borderRightWidth) === 0 && provisionalShapeMarker.borderRadius !== '999px'
  && !rewardKinds.has('confirmed') && /12,480/.test(gm06.document.gameUiText) && !/獲得しました|受取済|確定\s*\+?9|CRITICAL/.test(gm06.document.gameUiText);
const causalityMarkerByKind = new Map(gm06.elements.combatMarkers.filter((entry) => entry.visible).map((entry) => [entry.kind, entry]));
const gm06Events = canonicalGm06Fixture?.events ?? [];
const gm06EventTypesExact = JSON.stringify(gm06Events.map((event) => event.type)) === JSON.stringify(['combat.attack_started', 'combat.attack_released', 'combat.projectile_spawned', 'combat.projectile_arrived', 'combat.damage_applied', 'combat.entity_hit', 'combat.entity_defeated', 'reward.provisional']);
const gm06EventOrderExact = gm06Events.length === 8 && gm06Events.every((event, index) => /^\d+$/.test(event.simulationTick) && Number(event.simulationTick) <= Number(canonicalGm06Fixture.captureMomentMs) && event.stateVersion === String(index + 1) && (index === 0 || Number(event.simulationTick) >= Number(gm06Events[index - 1].simulationTick)));
const directEventMatch = (marker, event) => Boolean(marker && event && marker.eventId === event.eventId && marker.eventType === event.type && marker.simulationTick === event.simulationTick && marker.stateVersion === event.stateVersion
  && marker.sourceEntityId === (event.sourceEntityId ?? '') && marker.targetEntityId === (event.targetEntityId ?? '') && marker.entityId === (event.entityId ?? '') && marker.causeEventId === (event.causeEventId ?? '')
  && marker.attackEventId === (event.attackEventId ?? '') && marker.projectileEntityId === (event.projectileEntityId ?? '') && marker.amountDecimal === (event.amountDecimal ?? '')
  && marker.rewardEventId === (event.rewardEventId ?? '') && marker.settlementId === (event.settlementId ?? '') && marker.currencyCanonicalId === (event.currencyCanonicalId ?? '') && marker.defeatEventId === (event.defeatEventId ?? ''));
const attackMarker = causalityMarkerByKind.get('attack'); const projectileResidue = causalityMarkerByKind.get('projectile-path-residue'); const impactResidue = causalityMarkerByKind.get('impact-residue');
const damageMarker = causalityMarkerByKind.get('damage'); const hitMarker = causalityMarkerByKind.get('hit-reaction'); const defeatMarker = causalityMarkerByKind.get('defeat'); const rewardMarker = causalityMarkerByKind.get('reward-provisional');
const releasePrefixMatch = attackMarker && attackMarker.releaseEventId === gm06Events[1]?.eventId && attackMarker.releaseEventType === gm06Events[1]?.type && attackMarker.releaseSimulationTick === gm06Events[1]?.simulationTick && attackMarker.releaseStateVersion === gm06Events[1]?.stateVersion && attackMarker.releaseSourceEntityId === gm06Events[1]?.sourceEntityId;
const spawnPrefixMatch = projectileResidue && projectileResidue.spawnEventId === gm06Events[2]?.eventId && projectileResidue.spawnEventType === gm06Events[2]?.type && projectileResidue.spawnSimulationTick === gm06Events[2]?.simulationTick && projectileResidue.spawnStateVersion === gm06Events[2]?.stateVersion && projectileResidue.spawnProjectileEntityId === gm06Events[2]?.projectileEntityId && projectileResidue.spawnSourceEntityId === gm06Events[2]?.sourceEntityId && projectileResidue.spawnTargetEntityId === gm06Events[2]?.targetEntityId && projectileResidue.spawnAttackEventId === gm06Events[2]?.attackEventId;
const impactCenter = impactResidue?.rect ? { x: impactResidue.rect.left + impactResidue.rect.width / 2, y: impactResidue.rect.top + impactResidue.rect.height / 2 } : null;
const gm06MappedEnemy = mappedUnit(gm06, gm06.elements.enemy);
const impactSpatiallyBound = Boolean(impactCenter && gm06MappedEnemy?.hitCssBounds && impactCenter.x >= gm06MappedEnemy.hitCssBounds.left && impactCenter.x <= gm06MappedEnemy.hitCssBounds.right && impactCenter.y >= gm06MappedEnemy.hitCssBounds.top && impactCenter.y <= gm06MappedEnemy.hitCssBounds.bottom);
const causalityKinds = [...causalityMarkerByKind.keys()];
const causalityPass = gm06EventTypesExact && gm06EventOrderExact
  && ['attack', 'projectile-path-residue', 'impact-residue', 'damage', 'hit-reaction', 'defeat', 'reward-provisional'].every((kind) => causalityMarkerByKind.has(kind))
  && !causalityKinds.includes('anticipation') && !causalityKinds.includes('projectile-live') && !causalityKinds.includes('impact')
  && directEventMatch(attackMarker, gm06Events[0]) && releasePrefixMatch && spawnPrefixMatch && directEventMatch(projectileResidue, gm06Events[3])
  && directEventMatch(damageMarker, gm06Events[4]) && damageMarker.critical === String(gm06Events[4].critical) && damageMarker.text.includes(gm06Events[4].display)
  && directEventMatch(hitMarker, gm06Events[5]) && directEventMatch(defeatMarker, gm06Events[6]) && directEventMatch(rewardMarker, gm06Events[7])
  && rewardMarker.sourceEntityId === defeatMarker.entityId && rewardMarker.defeatEventId === defeatMarker.eventId && defeatMarker.causeEventId === damageMarker.eventId && hitMarker.causeEventId === damageMarker.eventId
  && projectileResidue.attackEventId === attackMarker.eventId && impactResidue.arrivalEventId === projectileResidue.eventId && impactResidue.damageEventId === damageMarker.eventId
  && canonicalGm06Fixture.impactClip === 'impact.residue' && impactResidue.effectClip === canonicalGm06Fixture.impactClip && impactResidue.flashActive === 'false' && impactResidue.targetEntityId === gm06.elements.enemy.canonicalId && impactResidue.targetAnchor === 'hitTarget' && impactSpatiallyBound
  && gm06.elements.combatMarkers.filter((entry) => entry.visible).every((entry) => intersects(entry.rect, stageBounds(gm06), 0.9))
  && gm06.elements.combatMarkers.filter((entry) => ['attack', 'projectile-path-residue', 'impact-residue', 'damage', 'hit-reaction', 'defeat'].includes(entry.kind)).every((entry) => intersects(entry.rect, gm06.elements.battlefield.rect, 0.5));
const supportPass = raw.scenarios.filter((scenario) => ['GM01', 'GM02', 'GM03', 'GM05', 'RV360', 'RV412'].includes(scenario.id)).every((scenario) => scenario.elements.support?.visible && scenario.elements.support.state === 'scheduled' && intersects(scenario.elements.support.rect, stageBounds(scenario), 0.9) && /次戦支援/.test(scenario.elements.support.text) && /商会配送/.test(scenario.elements.support.text) && /適用予定/.test(scenario.elements.support.text));
const gm04SupportBelowFoldPass = gm04.elements.support?.visible === true && gm04.elements.support.state === 'scheduled'
  && gm04.elements.support.rect.top >= gm04.viewport.height && gm04.document.stageScroll.scrollHeight > gm04.document.stageScroll.clientHeight
  && gm04.elements.support.rect.bottom <= gm04.document.stageScroll.scrollHeight + 1
  && /次戦支援/.test(gm04.elements.support.text) && /商会配送/.test(gm04.elements.support.text) && /適用予定/.test(gm04.elements.support.text);
const canonicalGm07Offline = fixtureByGm.get('GM07')?.offline;
const offlineScenarioPass = (scenario, compact = false) => {
  const text = scenario.elements.offlineModal?.label ?? '';
  const modal = scenario.elements.offlineModal;
  const base = canonicalGm07Offline?.defaultViewState === 'CONFIRMING' && canonicalGm07Offline?.uiMutation === false
    && scenario.document.gameUiInert === true && scenario.document.gameUiAriaHidden === 'true'
    && modal?.visible === true && modal.role === 'dialog' && modal.ariaModal === 'true' && modal.label.length > 0 && intersects(modal.rect, stageBounds(scenario), 0.95)
    && modal.labelledBy === 'offline-title'
    && text.includes(canonicalGm07Offline.titleDisplay) && text.includes(canonicalGm07Offline.elapsedDisplay) && text.includes(canonicalGm07Offline.defaultLabel) && text.includes(canonicalGm07Offline.outcomeDisplay)
    && text.includes(canonicalGm07Offline.capDisplay) && modal.elapsedSeconds === canonicalGm07Offline.elapsedSecondsDecimal && modal.capSeconds === canonicalGm07Offline.capSecondsDecimal
    && !/受取済|獲得しました|確定\s*1,840/.test(text)
    && scenario.elements.offlineProgress?.visible === true && scenario.elements.offlineProgress.role === 'progressbar' && scenario.elements.offlineProgress.ariaValueNow === ''
    && modal.controls.some((control) => control.visible && !control.disabled && control.label === canonicalGm07Offline.accessibleCloseName && control.label === canonicalGm07Offline.actionCopy.close)
    && modal.controls.filter((control) => !control.disabled).every((control) => !/受取|確定報酬/.test(control.label));
  if (!compact) return base;
  const safeBottom = scenario.environment.safeAreaInsets.bottom ?? 0; const safeTop = scenario.environment.safeAreaInsets.top ?? 0; const expectedBottom = scenario.viewport.height - safeBottom;
  return base && modal.rect.left <= 1 && modal.rect.right >= scenario.viewport.width - 1 && modal.rect.width >= scenario.viewport.width - 2 && modal.rect.bottom >= expectedBottom - 1 && modal.rect.bottom <= expectedBottom + 1 && modal.rect.top >= safeTop
    && scenario.elements.controls.filter((control) => control.visible).length === 1 && controlsFitAndDoNotOverlap(scenario);
};
const gm07CompactModalText = gm07Compact.elements.meaningfulText.filter((entry) => entry.visible);
const gm07CompactText200ModalText = gm07CompactText200.elements.meaningfulText.filter((entry) => entry.visible);
const gm07CompactText200ByKey = new Map(gm07CompactText200ModalText.map((entry) => [textKey(entry), entry]));
const gm07Text200Probe = gm07CompactText200.elements.offlineModal.fixedScrollProbe;
const gm07CompactText200Pass = offlineScenarioPass(gm07CompactText200, true)
  && JSON.stringify(gm07CompactText200.environment.safeAreaInsets) === JSON.stringify({ top: 24, right: 0, bottom: 34, left: 0 })
  && gm07CompactText200.environment.textScalePercent === 200 && Math.abs(gm07CompactText200.environment.rootFontSize - gm07Compact.environment.rootFontSize * 2) <= 0.05
  && gm07CompactModalText.length > 0 && gm07CompactText200ModalText.length === gm07CompactModalText.length
  && gm07CompactModalText.every((baseline) => gm07CompactText200ByKey.has(textKey(baseline)) && Math.abs(gm07CompactText200ByKey.get(textKey(baseline)).fontSize - baseline.fontSize * 2) <= 0.05)
  && gm07Text200Probe.bodyRole === 'region' && gm07Text200Probe.bodyTabIndex === '0' && gm07Text200Probe.bodyAriaLabel === '放置結果の詳細'
  && gm07Text200Probe.scrollHeight > gm07Text200Probe.clientHeight && gm07Text200Probe.scrollTopAfter > gm07Text200Probe.scrollTopInitial
  && Math.abs(gm07Text200Probe.headAfter.top - gm07Text200Probe.headInitial.top) <= 0.5 && Math.abs(gm07Text200Probe.footerAfter.bottom - gm07Text200Probe.footerInitial.bottom) <= 0.5
  && gm07Text200Probe.headAfter.top >= 24 && gm07Text200Probe.footerAfter.bottom <= gm07CompactText200.viewport.height - 34
  && gm07CompactText200.elements.offlineModal.controls.every((control) => control.visible && control.rect.width >= 48 && control.rect.height >= 48 && intersects(control.rect, stageBounds(gm07CompactText200), 0.9))
  && controlsFitAndDoNotOverlap(gm07CompactText200, true);
const canonicalOfflineVariants = canonicalGm07Offline?.stateVariants ?? [];
const decisionOfflineVariants = dataBindingMatrix.offlineViewStateDecisionTable ?? [];
const offlineVariantPass = Array.isArray(raw.offlineVariants) && raw.offlineVariants.length === 10
  && JSON.stringify(raw.offlineVariants.map((entry) => entry.viewState)) === JSON.stringify(canonicalOfflineVariants.map((entry) => entry.viewState))
  && JSON.stringify(raw.offlineVariants.map((entry) => entry.viewState)) === JSON.stringify(decisionOfflineVariants.map((entry) => entry.viewState))
  && raw.offlineVariants.every((entry, index) => {
    const fixture = canonicalOfflineVariants[index]; const decision = decisionOfflineVariants[index]; const dialog = entry.dialog;
    const actionMap = new Map(dialog.actions.map((action) => [action.kind, action]));
    const exactShapeByState = { NO_PROGRESS: 'flat-edge', ELAPSED_UNKNOWN: 'dotted-edge', RECONCILING_INDETERMINATE: 'hourglass-notch', RECONCILING_DETERMINATE: 'hourglass-notch', PROVISIONAL: 'open-edge', CONFIRMING: 'hourglass-notch', CONFIRMED: 'closed-brass-seal', REJECTED: 'barred-edge', RETRYABLE_ERROR: 'broken-loop-edge', UNKNOWN: 'dotted-edge' };
    const structuralShapePass = dialog.semanticShape.id === exactShapeByState[entry.viewState]
      && (dialog.semanticShape.id !== 'open-edge' || Number.parseFloat(dialog.semanticShape.borderRightWidth) === 0)
      && (dialog.semanticShape.id !== 'hourglass-notch' || (dialog.semanticShape.clipPath !== 'none' && dialog.semanticShape.clipPath.includes('polygon')))
      && (dialog.semanticShape.id !== 'closed-brass-seal' || dialog.semanticShape.borderStyle.includes('double'))
      && (dialog.semanticShape.id !== 'barred-edge' || dialog.semanticShape.borderStyle.includes('double'))
      && (dialog.semanticShape.id !== 'broken-loop-edge' || dialog.semanticShape.borderStyle.includes('dashed'))
      && (dialog.semanticShape.id !== 'dotted-edge' || dialog.semanticShape.borderStyle.includes('dotted'));
    const actionsExact = ['close', 'retry', 'continue'].every((kind) => actionMap.has(kind) === Boolean(decision.actions?.[kind]))
      && [...actionMap.values()].every((action) => action.enabled === true)
      && [...actionMap.values()].filter((action) => action.priority === 'primary').length === 1
      && (actionMap.has('retry') || actionMap.has('continue') ? actionMap.get('close')?.priority === 'secondary' : actionMap.get('close')?.priority === 'primary')
      && actionMap.get('close')?.label === canonicalGm07Offline.actionCopy.close
      && (!actionMap.has('retry') || actionMap.get('retry').label === canonicalGm07Offline.actionCopy.retry)
      && (!actionMap.has('continue') || actionMap.get('continue').label === canonicalGm07Offline.actionCopy.continue);
    const amountExpected = ['PROVISIONAL', 'CONFIRMING', 'CONFIRMED', 'RETRYABLE_ERROR'].includes(entry.viewState);
    const expectedAmountPrefix = entry.viewState === 'CONFIRMED' ? '確定' : '見込み';
    const amountsExact = amountExpected
      ? dialog.amountRows.length === 1 && dialog.amountRows[0].term === '獲得コイン' && dialog.amountRows[0].value === fixture.amount && dialog.amountRows[0].value.startsWith(expectedAmountPrefix + ' ') && dialog.amountRows[0].currencyCanonicalId === canonicalGm07Offline.outcomeCurrencyCanonicalId && dialog.amountRows[0].amountDecimal === canonicalGm07Offline.outcomeAmountDecimal
      : dialog.amountRows.length === 0;
    const progressExact = fixture.progress === 'none'
      ? dialog.progress.present === false
      : fixture.progress === 'trusted determinate'
        ? dialog.progress.present === true && dialog.progress.kind === 'determinate' && dialog.progress.role === 'progressbar' && dialog.progress.ariaValueNow === '64' && dialog.progress.ariaValueMax === '100' && dialog.progress.progressRatioDecimal === fixture.progressRatioDecimal && dialog.progress.fixtureClaimOnly === 'true' && dialog.progress.notRuntimeAuthority === 'true'
        : dialog.progress.present === true && dialog.progress.kind === 'indeterminate' && dialog.progress.role === 'progressbar' && dialog.progress.ariaValueNow === '' && dialog.progress.progressRatioDecimal === '';
    return entry.route.status === 200 && entry.route.redirectCount === 0 && entry.diagnostics.consoleErrors.length === 0 && entry.diagnostics.pageErrors.length === 0 && entry.diagnostics.failedRequests.length === 0 && entry.diagnostics.externalResources.length === 0 && entry.diagnostics.resourcePaths.length > 0 && entry.diagnostics.unexpectedResponses.length === 0
      && dialog.viewState === fixture.viewState && dialog.stateLabel === fixture.label && dialog.title === canonicalGm07Offline.titleDisplay
      && dialog.role === 'dialog' && dialog.ariaModal === 'true' && dialog.labelledBy === 'offline-title' && dialog.describedBy === 'offline-description'
      && dialog.capSeconds === canonicalGm07Offline.capSecondsDecimal && dialog.capDisplay === canonicalGm07Offline.capDisplay
      && !/28階|到達階/.test(dialog.description + ' ' + dialog.amountRows.map((row) => row.term + ' ' + row.value).join(' '))
      && dialog.settlementId === canonicalGm07Offline.settlementId && dialog.statusVersion === canonicalGm07Offline.statusVersion
      && dialog.retryCapability === (entry.viewState === 'RETRYABLE_ERROR' ? 'true' : 'false') && structuralShapePass && actionsExact && amountsExact && progressExact
      && dialog.walletAmountDecimal === canonicalGm07Offline.walletAtDefaultDecimal && /12,480/.test(dialog.walletText);
  });
const offlinePass = offlineScenarioPass(gm07) && offlineScenarioPass(gm07Compact, true) && gm07CompactText200Pass && offlineVariantPass;
const canonicalParty = gm08.elements.partyStates.filter((entry) => entry.visible);
const partyShapeByState = { field: 'raised-pennant-double-brass', owned: 'flat-tab-single-iron', available: 'ticket-notch-dashed-brass', locked: 'diagonal-corner-solid-iron' };
const pseudoPresent = (value) => !['', 'none', 'normal'].includes(value);
const exactPartyLabels = ['戦場参加中', '所有済み', '加入可能', '未解放'];
const gm08PartyLabelEvidence = exactPartyLabels.map((label) => gm08.elements.criticalLabels.find((entry) => entry.visible && entry.text === label));
const partyPass = canonicalParty.length === 4 && canonicalParty.every((entry) => intersects(entry.rect, gm08.elements.partyDock.rect, 0.95)) && JSON.stringify(canonicalParty.map((entry) => entry.state)) === JSON.stringify(['field', 'owned', 'available', 'locked'])
  && canonicalParty.every((entry) => entry.semanticShape === partyShapeByState[entry.state] && entry.iconPathData.length > 0)
  && new Set(canonicalParty.map((entry) => entry.iconPathData)).size === 4
  && canonicalParty.find((entry) => entry.state === 'field')?.borderStyle.includes('double') && pseudoPresent(canonicalParty.find((entry) => entry.state === 'field')?.beforeContent ?? '') && canonicalParty.find((entry) => entry.state === 'field')?.beforeClipPath.includes('polygon')
  && canonicalParty.find((entry) => entry.state === 'owned')?.borderStyle.includes('solid') && pseudoPresent(canonicalParty.find((entry) => entry.state === 'owned')?.beforeContent ?? '')
  && canonicalParty.find((entry) => entry.state === 'available')?.borderStyle.includes('dashed') && canonicalParty.find((entry) => entry.state === 'available')?.clipPath.includes('polygon')
  && canonicalParty.find((entry) => entry.state === 'locked')?.borderStyle.includes('solid') && canonicalParty.find((entry) => entry.state === 'locked')?.clipPath.includes('polygon') && pseudoPresent(canonicalParty.find((entry) => entry.state === 'locked')?.afterContent ?? '')
  && exactPartyLabels.every((label) => canonicalParty.some((entry) => entry.text.includes(label)))
  && gm08PartyLabelEvidence.every((entry) => entry && entry.rect.width >= 14 && entry.rect.height >= 14 && entry.scroll.clientWidth > 1 && entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1 && intersects(entry.rect, gm08.elements.partyDock.rect, 0.95))
  && gm08.elements.cats.filter((entry) => entry.visible).length === 1;
const reviewCopyPass = ['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME'].every((label) => gm01.document.bodyText.includes(label) && !gm01.document.gameUiText.includes(label));
const defeatNormal = gm01.elements.enemy; const defeatReward = gm06.elements.enemy;
const defeatDistinct = gm06.elements.combatMarkers.some((entry) => entry.kind === 'defeat' && entry.visible) && Boolean(defeatNormal && defeatReward)
  && (defeatNormal.sourceFrameId !== defeatReward.sourceFrameId || defeatNormal.transform !== defeatReward.transform || defeatNormal.opacity !== defeatReward.opacity)
  && stateComparisons[0].status === 'PASS';

const layoutAndVisualViewportPass = raw.scenarios.every((scenario) => {
  const visual = scenario.environment.visualViewport;
  return visual && Math.abs(visual.width - scenario.viewport.width) <= 0.01 && Math.abs(visual.height - scenario.viewport.height) <= 0.01
    && visual.offsetLeft === 0 && visual.offsetTop === 0 && visual.scale === 1 && visual.pageLeft === 0 && visual.pageTop === 0
    && scenario.environment.innerWidth === scenario.viewport.width && scenario.environment.innerHeight === scenario.viewport.height;
});
const initialScrollOriginPass = raw.scenarios.every((scenario) => scenario.document.initialScrollX === 0 && scenario.document.initialScrollY === 0 && scenario.document.initialStageScrollTop === 0);
const uniformFullScreenScaleAbsent = raw.scenarios.every((scenario) => {
  const surfaces = new Map(scenario.environment.surfaceGeometry.map((surface) => [surface.name, surface]));
  const noScale = ['html', 'body', 'gm-stage', 'game-ui'].every((name) => {
    const surface = surfaces.get(name);
    return surface?.transform === 'none' && surface.transformMatrix === null && Math.abs(surface.zoom - 1) <= 0.0001;
  });
  const reviewSurface = surfaces.get('review-stage'); const reviewIdentity = reviewSurface && Math.abs(reviewSurface.zoom - 1) <= 0.0001 && (reviewSurface.transform === 'none' || (Array.isArray(reviewSurface.transformMatrix) && JSON.stringify(reviewSurface.transformMatrix) === JSON.stringify([1, 0, 0, 1, 0, 0])));
  const gmSurface = surfaces.get('gm-stage'); const gameUiSurface = surfaces.get('game-ui');
  return noScale && reviewIdentity && gmSurface && gameUiSurface
    && Math.abs(gmSurface.rect.width - scenario.viewport.width) <= 0.01 && Math.abs(gmSurface.rect.height - scenario.viewport.height) <= 0.01
    && Math.abs(gmSurface.rectToLayoutViewport.width - 1) <= 0.0001 && Math.abs(gmSurface.rectToLayoutViewport.height - 1) <= 0.0001
    && Math.abs(gameUiSurface.rect.width - scenario.viewport.width) <= 0.01 && gameUiSurface.rect.height >= scenario.viewport.height;
});
const parseCssTimeMs = (value) => {
  const match = /^([0-9.]+(?:e[+-]?\d+)?)(ms|s)$/i.exec(String(value).trim());
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
};
const timeListMaximum = (value) => Math.max(...String(value).split(',').map(parseCssTimeMs));
const iterationListMaximum = (value) => Math.max(...String(value).split(',').map((token) => token.trim() === 'infinite' ? Number.POSITIVE_INFINITY : Number(token.trim())));
const motionGroupCounts = new Map(['background', 'cat-idle', 'enemy-idle', 'offline-progress', 'combat-effects'].map((kind) => [kind, 0]));
let reducedMotionPolicyNative = true;
for (const scenario of raw.scenarios) for (const group of scenario.environment.reducedMotionPolicy.targets) {
  motionGroupCounts.set(group.kind, motionGroupCounts.get(group.kind) + group.records.length);
  for (const record of group.records) {
    const animationsNone = String(record.animationName).split(',').every((name) => name.trim() === 'none');
    const animationReduced = animationsNone || (timeListMaximum(record.animationDuration) <= 0.001 && iterationListMaximum(record.animationIterationCount) <= 1);
    const transitionReduced = timeListMaximum(record.transitionDuration) <= 0.001;
    if (!animationReduced || !transitionReduced) reducedMotionPolicyNative = false;
  }
}
reducedMotionPolicyNative = reducedMotionPolicyNative
  && [...motionGroupCounts.values()].every((count) => count > 0)
  && raw.scenarios.every((scenario) => scenario.environment.reducedMotionPolicy.prefersReducedMotion === true && scenario.environment.reducedMotionPolicy.stabilizationApplied === false
    && scenario.environment.captureStabilization.appliedAfterPolicyCollection === true
    && scenario.environment.captureStabilization.cssSha256 === 'sha256:' + createHash('sha256').update('*,*::before,*::after{animation-play-state:paused!important;caret-color:transparent!important;transition:none!important}', 'utf8').digest('hex'));
const browserModesPass = raw.browserModes.gmSwitches.length === 8
  && raw.browserModes.fitActual.fitBefore.actualSizeClass === false && raw.browserModes.fitActual.actual.actualSizeClass === true && raw.browserModes.fitActual.fitAfter.actualSizeClass === false
  && raw.browserModes.referenceCompare.closedBefore.referenceHidden === true && raw.browserModes.referenceCompare.open.referenceViewportVisible === true && raw.browserModes.referenceCompare.closedAfter.referenceHidden === true
  && raw.browserModes.diagnostics.consoleErrors.length === 0 && raw.browserModes.diagnostics.pageErrors.length === 0 && raw.browserModes.diagnostics.failedRequests.length === 0 && raw.browserModes.diagnostics.externalResources.length === 0 && raw.browserModes.diagnostics.unexpectedResponses.length === 0;
const densityComponents = (scenario) => [
  scenario.elements.densityMetrics.header,
  ...scenario.elements.densityMetrics.resourceChips,
  scenario.elements.densityMetrics.primaryControl,
  scenario.elements.densityMetrics.bottomNavigation,
  ...scenario.elements.densityMetrics.navigationControls
];
const gm01Density = densityComponents(gm01); const gm05Density = densityComponents(byId.get('GM05'));
const gm05UiAntiBloat = gm01Density.length === gm05Density.length && gm01Density.every((baseline, index) => {
  const expanded = gm05Density[index]; const heightMaximum = Math.min(baseline.rect.height + gm05AntiBloatContract.heightMaximumAdditiveCssPx, baseline.rect.height * gm05AntiBloatContract.heightMaximumRatio);
  return Math.abs(expanded.fontSize - baseline.fontSize) <= gm05AntiBloatContract.computedFontSizeToleranceCssPx
    && expanded.rect.height >= baseline.rect.height - 0.01 && expanded.rect.height <= heightMaximum + 0.01;
});
const compactScenarioIds = ['GM04', 'GM02', 'GM03', 'TEXT200', 'GM07C320', 'GM07C320TEXT200', 'TEXT200SAFE'];
const partyGapPasses = (records) => Array.isArray(records) && records.length > 0 && records.every((entry) => entry.gap >= 8);
invariant(!partyGapPasses([{ firstIndex: 0, secondIndex: 1, axis: 'horizontal', gap: 0 }]), 'trusted party-gap gate accepts a zero-gap negative vector');
const allScenarioHorizontalAndCriticalPass = raw.scenarios.every((scenario) => scenario.document.stageScroll.scrollWidth <= scenario.document.stageScroll.clientWidth + 1
  && scenario.document.documentScroll.scrollWidth <= scenario.document.documentScroll.clientWidth + 1
  && scenario.elements.criticalLabels.length > 0
  && scenario.elements.criticalLabels.every((entry) => entry.visible && entry.rect && entry.rect.left >= 0 && entry.rect.right <= scenario.viewport.width + 0.01
    && entry.scroll.scrollWidth <= entry.scroll.clientWidth + 1 && entry.scroll.scrollHeight <= entry.scroll.clientHeight + 1));
const responsiveGeometryPass = combatScenarios.every((scenario) => scenario.elements.layoutMetrics.battlefield.rect.height >= responsiveByViewport.get(`${scenario.viewport.width}x${scenario.viewport.height}`).battlefieldMinimumCssPx)
  && compactScenarioIds.every((id) => {
    const layout = byId.get(id).elements.layoutMetrics;
    return layout.partyCards.every((rect) => rect.width >= 68 && rect.height >= 76) && layout.partyInterCardGaps.every((entry) => entry.gap >= 8);
  })
  && raw.scenarios.every((scenario) => partyGapPasses(scenario.elements.layoutMetrics.partyInterCardGaps))
  && allScenarioHorizontalAndCriticalPass
  && raw.scenarios.every((scenario) => scenario.elements.layoutMetrics.navigationControls.every((control) => control.rect.height >= 64))
  && raw.scenarios.filter((scenario) => Object.values(scenario.environment.safeAreaInsets).every((value) => value === 0)).every((scenario) => {
    const layout = scenario.elements.layoutMetrics;
    const contentBottom = scenario.document.stageScroll.scrollHeight > scenario.document.stageScroll.clientHeight ? scenario.document.stageScroll.scrollHeight : scenario.viewport.height;
    return layout.header.paddingTop >= 8 && scenario.elements.densityMetrics.resourceChips.every((chip) => chip.rect.top >= 8)
      && layout.bottomNavigation.paddingBottom >= 8 && layout.navigationControls.every((control) => control.rect.bottom <= contentBottom - 8 + 0.01);
  })
  && gm07CompactText200.elements.offlineModal.rect.height <= gm07CompactText200.viewport.height - gm07CompactText200.environment.safeAreaInsets.top - gm07CompactText200.environment.safeAreaInsets.bottom - 16 + 0.01;

assertion('VISIBLE_CAT_ALPHA_HEIGHT_MIN_60', rounded(catMinimum));
assertion('VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80', rounded(enemyMinimum));
assertion('STANDARD_CAT_ALPHA_HEIGHT_MIN_68', rounded(standardCatMinimum));
assertion('STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96', rounded(standardEnemyMinimum));
assertion('TRANSPARENT_WRAPPER_EXCLUDED', mappingComplete && mappedCats.concat(mappedEnemies).every((entry) => entry.visibleHeight <= entry.wrapperHeight + 0.5));
assertion('NON_UNIFORM_CHARACTER_SCALE_ABSENT', rounded(maximumScaleDelta));
assertion('FOOT_AND_HIT_ANCHORS_BOUND', staticChecks.get('ANIMATION_ANCHORS_COMPLETE') === true && anchorBindingPass && impactSpatiallyBound);
assertion('DEFEAT_POSE_VISUALLY_DISTINCT', defeatDistinct);
assertion('MEANINGFUL_TEXT_MIN_14', rounded(minimumMeaningfulText));
assertion('METADATA_TEXT_MIN_12', rounded(minimumMetadataText));
assertion('PRIMARY_LABEL_MIN_14', rounded(minimumPrimaryText));
assertion('PRIMARY_CONTROL_HIT_AREA_MIN_48', rounded(minimumPrimaryControl));
assertion('IMPORTANT_CONTROL_HIT_AREA_MIN_44', rounded(minimumImportantControl));
assertion('CONTROL_HIT_BOUNDS_NONOVERLAP', controlBoundsPass);
assertion('CONTROL_HIT_BOUNDS_MIN_GAP_8', rounded(minimumControlGap));
assertion('MEANINGFUL_TEXT_CONTRAST_WCAG', contrastPass);
assertion('STATE_SEMANTICS_NOT_COLOR_ONLY', stateSemanticsPass);
assertion('DESIGN_TOKEN_DRIFT_ZERO', staticChecks.get('DESIGN_TOKEN_DRIFT_ZERO') ?? -1);
assertion('SEVEN_REQUIRED_VIEWPORTS_PASS', viewportPassCount);
assertion('NONZERO_SAFE_AREA_PASS', safePass);
assertion('TEXT_200_PERCENT_NO_LOSS', text200Pass && text200SafePass);
assertion('LAYOUT_AND_VISUAL_VIEWPORT_MATCH', layoutAndVisualViewportPass);
assertion('INITIAL_SCROLL_ORIGIN_ZERO', initialScrollOriginPass);
assertion('UNIFORM_FULL_SCREEN_SCALE_ABSENT', uniformFullScreenScaleAbsent);
assertion('REDUCED_MOTION_POLICY_NATIVE', reducedMotionPolicyNative);
assertion('REVIEW_BROWSER_MODES_OPERABLE', browserModesPass);
assertion('GM05_UI_ANTI_BLOAT', gm05UiAntiBloat);
assertion('RESPONSIVE_GEOMETRY_CONTRACT', responsiveGeometryPass);
assertion('GM04_REFLOW_OR_SCROLL_PASS', gm04Pass);
assertion('UNBOUND_RUBY_REMOVED', noRuby);
assertion('UNBOUND_RANK_REMOVED_OR_BOUND', noRank);
assertion('KILL_COUNTER_AND_OBJECTIVE_CONSISTENT', raw.scenarios.filter((scenario) => scenario.state === 'normal').every(killConsistent) && gm06ObjectivePass && fixtureBindingPass);
assertion('REWARD_PROVISIONAL_NOT_CONFIRMED', rewardTruthPass);
assertion('ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE', causalityPass);
assertion('SUPPORT_NEXT_BATTLE_CAUSALITY_VISIBLE', supportPass);
assertion('GM04_SUPPORT_REMAINS_AVAILABLE', gm04SupportBelowFoldPass);
assertion('OFFLINE_RECONCILIATION_ACCESSIBLE', offlinePass);
assertion('PARTY_STATE_LABELS_CANONICAL', partyPass);
assertion('REVIEW_COPY_EXCLUDED_FROM_GAME_UI', reviewCopyPass);
assertion('EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', staticChecks.get('EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES') === true);
assertion('ANIMATION_ANCHORS_COMPLETE', staticChecks.get('ANIMATION_ANCHORS_COMPLETE') === true);
assertion('NINE_SLICE_CAPS_AND_MINIMUMS_VALID', staticChecks.get('NINE_SLICE_CAPS_AND_MINIMUMS_VALID') === true);
assertion('PRIMARY_SOURCE_COMPETITORS_6_TO_10', staticChecks.get('PRIMARY_SOURCE_COMPETITORS_6_TO_10') ?? -1);
assertion('OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED', staticChecks.get('OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED') === true);
assertion('ALL_TEN_FINDING_GROUPS_AUTOMATED', staticChecks.get('ALL_TEN_FINDING_GROUPS_AUTOMATED') ?? -1);
invariant(findingAssertions.length === Object.keys(criteria).length
  && JSON.stringify(findingAssertions.map((entry) => entry.id)) === JSON.stringify(Object.keys(criteria))
  && new Set(findingAssertions.map((entry) => entry.id)).size === findingAssertions.length,
'finding criteria are not emitted exactly once in canonical order');

const report = {
  schemaVersion: 2,
  artifactId: 'cats-tower-s02-golden-master-p1-browser-evidence-round-002',
  repository,
  branch,
  head: raw.head,
  tree: raw.tree,
  rawEvidenceSha256: 'sha256:' + createHash('sha256').update(rawBytes).digest('hex'),
  ...(revisionMode ? { baselineRawSha256, revisionComparisonSha256 } : {}),
  viewports: ['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932'],
  goldenMasters: ['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08'],
  findingAssertions,
  screenshots,
  pixelStats,
  stateComparisons,
  failures,
  verdict: failures.length === 0 ? 'PASS_S02_GOLDEN_MASTER_P1_BROWSER' : 'FAIL_S02_GOLDEN_MASTER_P1_BROWSER',
  physicalIPhoneVerified: false,
  productionMutationPerformed: false
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verdict: report.verdict, scenarioCount: raw.scenarios.length, failureCount: failures.length }) + '\n');
if (failures.length > 0) process.exitCode = 1;
