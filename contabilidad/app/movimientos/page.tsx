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
  const viewParam = searchParams?.view;
  const initialLibroId = Array.isArray(libroParam)
    ? libroParam[0] ?? null
    : libroParam ?? null;
  const viewValue = Array.isArray(viewParam)
    ? viewParam[0] ?? ""
    : viewParam ?? "";
  const onlyTable = viewValue === "tabla";
  const clientKey = `${initialLibroId ?? "none"}:${onlyTable ? "tabla" : "full"}`;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">
          Cargando movimientos...
        </div>
      }
    >
      <MovimientosClient
        key={clientKey}
        initialLibroId={initialLibroId}
        onlyTable={onlyTable}
      />
    </Suspense>
  );
}
