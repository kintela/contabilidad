import { Suspense } from "react";
import MovimientosClient from "./MovimientosClient";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

export default function MovimientosPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const libroParam = searchParams?.libro;
  const initialLibroId = Array.isArray(libroParam)
    ? libroParam[0] ?? null
    : libroParam ?? null;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">
          Cargando movimientos...
        </div>
      }
    >
      <MovimientosClient initialLibroId={initialLibroId} />
    </Suspense>
  );
}
