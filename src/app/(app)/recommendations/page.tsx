"use client";
import { useApi, useApp } from "@/lib/client/hooks";
import { RecommendationList, type Rec } from "@/components/recommendations";
import { Alert, EmptyState, LinkButton, PageHeader, SavedDataNotice, Spinner } from "@/components/ui";

export default function RecommendationsPage() {
  const { farmId, farms } = useApp();
  const { data, loading, error, reload, savedAt } = useApi<{ recommendations: Rec[] }>(farmId ? `/farms/${farmId}/recommendations` : null);
  const farm = farms.find((f) => f.id === farmId);
  return (
    <>
      <PageHeader title="Recommendations" description={`Agricultural insights for ${farm?.name ?? "your farm"}, with the reason each was generated. AgriSense flags concerns — it does not prescribe exact input amounts.`} />
      <SavedDataNotice savedAt={savedAt} />
      {!farmId ? (
        <EmptyState title="No farm selected" action={<LinkButton href="/farms?new=1">Add a farm</LinkButton>} />
      ) : loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : (
        <RecommendationList items={data?.recommendations ?? []} onChange={reload} />
      )}
    </>
  );
}
