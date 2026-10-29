import type { ProjectDetails } from "../api";

type LegacyAnnotation = { customer_name?: string; project_number?: string };
type Identity = { customer: string; number: string; customerLegacy: boolean; numberLegacy: boolean };

// Project details win; legacy floor annotation values are a read-only fallback.
export function resolveProjectIdentity(details: Pick<ProjectDetails, "client_name" | "project_number"> | undefined, legacy: LegacyAnnotation): Identity {
  const customer = details?.client_name?.trim() ?? "";
  const number = details?.project_number?.trim() ?? "";
  const legacyCustomer = legacy.customer_name?.trim() ?? "";
  const legacyNumber = legacy.project_number?.trim() ?? "";
  return {
    customer: customer || legacyCustomer,
    number: number || legacyNumber,
    customerLegacy: !customer && !!legacyCustomer,
    numberLegacy: !number && !!legacyNumber,
  };
}
