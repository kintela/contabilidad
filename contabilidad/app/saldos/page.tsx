import { Suspense } from "react";
import SaldosClient from "./SaldosClient";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

export default function SaldosPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const libroParam = searchParams?.libro;
  const initialLibroId = Array.isArray(libroParam)
    ? libroParam[0] ?? null
    : libroParam ?? null;
  const clientKey = initialLibroId ?? "none";

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">
          Cargando saldos...
        </div>
      }
    >
      <SaldosClient key={clientKey} initialLibroId={initialLibroId} />
    </Suspense>
  );
}
