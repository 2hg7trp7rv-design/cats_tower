const TRANSITIONS = {
  'transition.draw.v2': {
    CREATED:['VALIDATING','FAILED_BEFORE_COMMIT'], VALIDATING:['RESOURCES_RESERVED','FAILED_BEFORE_COMMIT'], RESOURCES_RESERVED:['RNG_COMMITTED','RECOVERY_REQUIRED'], RNG_COMMITTED:['RESULT_GRANTED','RECOVERY_REQUIRED'], RESULT_GRANTED:['RECORDED','RECOVERY_REQUIRED'], RECOVERY_REQUIRED:['RESULT_GRANTED','RECORDED']
  },
  'transition.payment.v2': {
    CREATED:['STORE_PENDING','FAILED'], STORE_PENDING:['STORE_PURCHASED','FAILED'], STORE_PURCHASED:['SERVER_VERIFYING','REFUNDED','REVOKED'], SERVER_VERIFYING:['ENTITLEMENT_GRANTED','FAILED','REFUNDED','REVOKED'], ENTITLEMENT_GRANTED:['ACKNOWLEDGED','REFUNDED','REFUND_DEFICIT_RECORDED','REVOKED'], ACKNOWLEDGED:['REFUNDED','REFUND_DEFICIT_RECORDED','REVOKED','RESTORED'], REFUNDED:['RESTORED'], REVOKED:['RESTORED']
  },
  'transition.rewarded_ad.v2': {
    OFFERED:['OPTED_IN','OFFER_STALE','FAILED'], OPTED_IN:['CONSENT_CHECKED','OFFER_STALE','FAILED'], CONSENT_CHECKED:['STARTED','FAILED'], STARTED:['NETWORK_COMPLETED','FAILED'], NETWORK_COMPLETED:['SERVER_VERIFYING','FAILED'], SERVER_VERIFYING:['GRANTED','CAP_REJECTED','FAILED']
  },
  'transition.login_claim.v2': {
    ELIGIBLE:['CLAIM_REQUESTED','NOT_ELIGIBLE','EXPIRED','CAMPAIGN_STALE','SERVER_TIME_ERROR'], CLAIM_REQUESTED:['GRANTED','ALREADY_CLAIMED','NOT_ELIGIBLE','EXPIRED','CAMPAIGN_STALE','SERVER_TIME_ERROR']
  },
  'transition.reset.v2': {
    NOT_ELIGIBLE:['QUOTE_ISSUED'], QUOTE_ISSUED:['CONFIRMED','QUOTE_EXPIRED','FAILED_BEFORE_COMMIT'], CONFIRMED:['COMMITTING','FAILED_BEFORE_COMMIT'], COMMITTING:['APPLIED','RECOVERY_REQUIRED'], RECOVERY_REQUIRED:['APPLIED']
  },
  'transition.evolution.v2': {
    NOT_ELIGIBLE:['ELIGIBLE'], ELIGIBLE:['QUOTE_ISSUED'], QUOTE_ISSUED:['CONFIRMED','QUOTE_EXPIRED','FAILED'], CONFIRMED:['RUBY_DEBITED','FAILED'], RUBY_DEBITED:['EVOLUTION_GRANTED'], EVOLUTION_GRANTED:['RECORDED']
  },
  'transition.mastery_exchange.v2': {
    QUOTE_ISSUED:['CONFIRMED','QUOTE_STALE','FAILED'], CONFIRMED:['RESOURCE_DEBITED','QUOTE_STALE','FAILED'], RESOURCE_DEBITED:['MASTERY_APPLIED','CAP_REACHED'], MASTERY_APPLIED:['RECORDED','CAP_REACHED'], CAP_REACHED:['OVERFLOW_CREDITED'], OVERFLOW_CREDITED:['RECORDED']
  },
  'transition.account_link.v2': {
    GUEST:['AUTHENTICATING','CANCELLED'], AUTHENTICATING:['SERVER_SNAPSHOT_FETCHED','CANCELLED','RECOVERY_REQUIRED'], SERVER_SNAPSHOT_FETCHED:['CONFLICT_REVIEW','MERGING','RECOVERY_REQUIRED'], CONFLICT_REVIEW:['MERGING','CANCELLED'], MERGING:['LINKED','RECOVERY_REQUIRED'], RECOVERY_REQUIRED:['SERVER_SNAPSHOT_FETCHED','MERGING','LINKED']
  },
  'transition.account_deletion.v1': {
    ACTIVE:['DELETE_QUOTE_ISSUED'], DELETE_QUOTE_ISSUED:['CONFIRMED','CANCELLED','FAILED'], CONFIRMED:['DELETION_PENDING','CANCELLED','FAILED'], DELETION_PENDING:['ENTITLEMENT_RECONCILIATION','FAILED'], ENTITLEMENT_RECONCILIATION:['DELETED','RETENTION_EXCEPTION_RECORDED','FAILED']
  },
};

export function canTransition(machineId, from, to) {
  return Boolean(TRANSITIONS[machineId]?.[from]?.includes(to));
}

export function replaySequence(machineId, states) {
  if (!Array.isArray(states) || states.length < 1) throw new Error('state sequence is required');
  for (let i=1;i<states.length;i+=1) {
    if (!canTransition(machineId, states[i-1], states[i])) throw new Error(`INVALID_TRANSITION:${machineId}:${states[i-1]}->${states[i]}`);
  }
  return { machineId, finalState: states.at(-1), transitionCount: String(states.length-1) };
}

export function idempotentResult(store, key, operation) {
  if (!key) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  if (store.has(key)) return { replayed:true, result:store.get(key) };
  const result=operation();
  store.set(key, result);
  return { replayed:false, result };
}

export function acceptedVersionRetry({ acceptedVersion, currentVersion, accepted }) {
  if (!accepted && acceptedVersion !== currentVersion) return { outcome:'STALE_BEFORE_ACCEPT', version:currentVersion };
  return { outcome:'RECONCILE_ACCEPTED_VERSION', version:acceptedVersion };
}

export function exactlyOnceReceipt(store, receiptId, grant) {
  if (!receiptId) throw new Error('RECEIPT_REQUIRED');
  if (store.has(receiptId)) return { duplicate:true, grant:store.get(receiptId) };
  store.set(receiptId, grant);
  return { duplicate:false, grant };
}

export { TRANSITIONS };
