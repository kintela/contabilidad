"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

type Libro = {
  id: string;
  nombre: string;
  moneda: string | null;
};

type Saldo = {
  id: string;
  libro_id: string;
  mes: string;
  saldo: number | null;
  created_at?: string | null;
};

type EditableField = "mes" | "saldo";

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const formatter = new Intl.DateTimeFormat("es-ES", { month: "long" });
  const label = formatter.format(new Date(2020, index, 1));
  return {
    value: index + 1,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
});

const sortSaldos = (rows: Saldo[]) =>
  [...rows].sort((a, b) => {
    const dateDiff = new Date(b.mes).getTime() - new Date(a.mes).getTime();
    if (dateDiff !== 0) return dateDiff;
    const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return createdB - createdA;
  });

type SaldosClientProps = {
  initialLibroId?: string | null;
};

export default function SaldosClient({
  initialLibroId = null,
}: SaldosClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryLibroId = searchParams.get("libro");
  const requestedLibroId = queryLibroId ?? initialLibroId;

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [libros, setLibros] = useState<Libro[]>([]);
  const [librosLoading, setLibrosLoading] = useState(false);
  const [librosError, setLibrosError] = useState<string | null>(null);
  const [selectedLibroId, setSelectedLibroId] = useState<string | null>(
    initialLibroId ?? null
  );

  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [saldosLoading, setSaldosLoading] = useState(false);
  const [saldosError, setSaldosError] = useState<string | null>(null);

  const [addYear, setAddYear] = useState<number>(CURRENT_YEAR);
  const [addMonth, setAddMonth] = useState<number>(CURRENT_MONTH);
  const [addSaldo, setAddSaldo] = useState("");
  const [addSaldoLoading, setAddSaldoLoading] = useState(false);
  const [addSaldoError, setAddSaldoError] = useState<string | null>(null);

  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: EditableField;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        setSessionError(error.message);
      }
      const nextSession = data.session ?? null;
      setSession(nextSession);
      setSessionLoading(false);
      if (!nextSession) {
        router.replace("/dashboard");
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isMounted) return;
        setSession(nextSession);
        setSessionLoading(false);
        if (!nextSession) {
          router.replace("/dashboard");
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const loadLibros = async () => {
      setLibrosLoading(true);
      setLibrosError(null);

      const { data: permisos, error: permisosError } = await supabase
        .from("permisos_libro")
        .select("libro_id")
        .eq("usuario_id", session.user.id);

      if (permisosError) {
        setLibrosError(permisosError.message);
        setLibrosLoading(false);
        return;
      }

      const libroIds = (permisos ?? [])
        .map((permiso) => permiso.libro_id)
        .filter(Boolean);

      if (libroIds.length === 0) {
        setLibros([]);
        setSelectedLibroId(null);
        setLibrosLoading(false);
        return;
      }

      const { data: librosData, error: librosError } = await supabase
        .from("libros")
        .select("id, nombre, moneda")
        .in("id", libroIds);

      if (librosError) {
        setLibrosError(librosError.message);
        setLibrosLoading(false);
        return;
      }

      const ordered = [...(librosData ?? [])].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es-ES")
      );
      setLibros(ordered);

      const desiredId = requestedLibroId;
      const currentId =
        desiredId && ordered.some((libro) => libro.id === desiredId)
          ? desiredId
          : null;

      if (currentId) {
        setSelectedLibroId(currentId);
      } else {
        const userEmail = session.user.email?.toLowerCase() ?? "";
        const preferredNames =
          userEmail === "roberto.quintela@protonmail.com"
            ? ["personal"]
            : ["comun"];

        const preferredLibro =
          ordered.find((libro) =>
            preferredNames.includes(
              libro.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            )
          ) ?? ordered[0];

        setSelectedLibroId(preferredLibro?.id ?? null);
      }

      setLibrosLoading(false);
    };

    loadLibros();
  }, [session, requestedLibroId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!selectedLibroId) {
      setSaldos([]);
      setSaldosError(null);
      return;
    }

    const loadSaldos = async () => {
      setSaldosLoading(true);
      setSaldosError(null);

      const { data, error } = await supabase
        .from("saldos_mensuales")
        .select("id, libro_id, mes, saldo, created_at")
        .eq("libro_id", selectedLibroId)
        .order("mes", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        setSaldosError(error.message);
        setSaldos([]);
        setSaldosLoading(false);
        return;
      }

      setSaldos(sortSaldos(data ?? []));
      setSaldosLoading(false);
    };

    loadSaldos();
  }, [session, selectedLibroId]);

  const selectedLibro = libros.find((libro) => libro.id === selectedLibroId);
  const currency = selectedLibro?.moneda ?? "EUR";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const formatMonth = (value: string) =>
    new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "long",
    }).format(new Date(value));

  const addMesPreview = useMemo(() => {
    const month = String(addMonth).padStart(2, "0");
    return `${addYear}-${month}-01`;
  }, [addYear, addMonth]);

  const addYearOptions = useMemo(() => {
    const set = new Set<number>();
    set.add(CURRENT_YEAR);
    saldos.forEach((saldo) => {
      const year = new Date(saldo.mes).getFullYear();
      if (!Number.isNaN(year)) {
        set.add(year);
      }
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [saldos]);

  const parseSaldoValue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let normalized = trimmed.replace(/\s/g, "");
    if (normalized.includes(",")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if ((normalized.match(/\./g) ?? []).length > 1) {
      normalized = normalized.replace(/\./g, "");
    }
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  };

  const parseMonthInput = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
    const [year, month] = trimmed.split("-").map(Number);
    const date = new Date(year, month - 1, 1);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1) {
      return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-01`;
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditingValue("");
    setEditError(null);
  };

  const isEditing = (id: string, field: EditableField) =>
    editingCell?.id === id && editingCell.field === field;

  const startEdit = (saldo: Saldo, field: EditableField) => {
    if (editSaving) return;
    if (editingCell?.id === saldo.id && editingCell.field === field) return;
    setEditError(null);
    setEditingCell({ id: saldo.id, field });
    if (field === "mes") {
      setEditingValue(saldo.mes?.slice(0, 7) ?? "");
    } else if (field === "saldo") {
      setEditingValue(
        Number.isFinite(Number(saldo.saldo ?? 0))
          ? String(saldo.saldo ?? "")
          : ""
      );
    } else {
      setEditingValue("");
    }
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    if (editSaving) return;
    const target = saldos.find((row) => row.id === editingCell.id);
    if (!target) {
      cancelEdit();
      return;
    }

    const updates: Partial<Saldo> = {};
    const payload: Record<string, unknown> = {};

    if (editingCell.field === "mes") {
      const nextMes = parseMonthInput(editingValue);
      if (!nextMes) {
        setEditError("El mes no es válido.");
        return;
      }
      const alreadyExists = saldos.some(
        (row) =>
          row.id !== target.id && row.mes?.slice(0, 7) === nextMes.slice(0, 7)
      );
      if (alreadyExists) {
        setEditError("Ya existe un saldo para ese mes.");
        return;
      }
      payload.mes = nextMes;
      updates.mes = nextMes;
    } else if (editingCell.field === "saldo") {
      const nextSaldo = parseSaldoValue(editingValue);
      if (nextSaldo === null) {
        setEditError("Introduce un saldo válido.");
        return;
      }
      payload.saldo = nextSaldo;
      updates.saldo = nextSaldo;
    }

    if (Object.keys(payload).length === 0) {
      cancelEdit();
      return;
    }

    setEditSaving(true);

    const { data, error } = await supabase
      .from("saldos_mensuales")
      .update(payload)
      .eq("id", target.id)
      .select("id, libro_id, mes, saldo, created_at")
      .single();

    if (error) {
      setEditError(error.message);
      setEditSaving(false);
      return;
    }

    setSaldos((prev) =>
      sortSaldos(prev.map((row) => (row.id === target.id ? data : row)))
    );

    setEditSaving(false);
    cancelEdit();
  };

  const handleEditKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  };

  const handleAddSaldo = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setAddSaldoError(null);

    if (!selectedLibroId) {
      setAddSaldoError("Selecciona un libro antes de añadir saldos.");
      return;
    }

    const mesValue = addMesPreview;
    const amount = parseSaldoValue(addSaldo);
    if (amount === null) {
      setAddSaldoError("Introduce un saldo válido.");
      return;
    }

    const alreadyExists = saldos.some(
      (row) => row.mes?.slice(0, 7) === mesValue.slice(0, 7)
    );
    if (alreadyExists) {
      setAddSaldoError("Ya existe un saldo para ese mes.");
      return;
    }

    setAddSaldoLoading(true);

    const { data, error } = await supabase
      .from("saldos_mensuales")
      .insert({
        libro_id: selectedLibroId,
        mes: mesValue,
        saldo: amount,
      })
      .select("id, libro_id, mes, saldo, created_at")
      .single();

    if (error) {
      setAddSaldoError(error.message);
      setAddSaldoLoading(false);
      return;
    }

    setSaldos((prev) => sortSaldos([data, ...prev]));
    setAddSaldo("");
    setAddSaldoLoading(false);
  };

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        dateStyle: "full",
      }).format(new Date()),
    []
  );

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">
        Cargando sesión...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[var(--background)] p-10 text-sm text-[var(--muted)]">
        Redirigiendo al dashboard...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(1200px_circle_at_8%_-10%,rgba(15,118,110,0.2),transparent_60%),radial-gradient(900px_circle_at_110%_10%,rgba(251,146,60,0.2),transparent_55%)]">
      <div className="pointer-events-none absolute -left-24 top-24 h-64 w-64 rounded-full bg-emerald-400/20 blur-[120px]" />
      <div className="pointer-events-none absolute right-8 top-32 h-48 w-48 rounded-full bg-amber-300/30 blur-[100px]" />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10 lg:px-12">
        <header className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="rounded-full border border-black/10 bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)] shadow-sm dark:border-white/10">
              {todayLabel}
            </div>
            <Link
              href="/dashboard"
              className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] underline decoration-transparent transition hover:text-[var(--accent)] hover:decoration-[var(--accent)]"
            >
              Volver al dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                Saldos
              </p>
              <h1
                className="mt-2 text-4xl font-semibold leading-tight text-[var(--foreground)] sm:text-5xl"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Saldos mensuales
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Libro · {selectedLibro?.nombre ?? "Sin libro seleccionado"}
              </p>
            </div>
          </div>
        </header>

        {sessionError && (
          <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            {sessionError}
          </p>
        )}

        <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2
                className="text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Nuevo saldo
              </h2>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Guarda el saldo del mes
              </p>
            </div>
            {librosLoading ? (
              <span className="text-xs text-[var(--muted)]">
                Cargando libros...
              </span>
            ) : librosError ? (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {librosError}
              </span>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>Libro</span>
                <select
                  className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={selectedLibroId ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedLibroId(value ? value : null);
                  }}
                  disabled={libros.length === 0}
                >
                  {libros.length === 0 && (
                    <option value="">Sin libros</option>
                  )}
                  {libros.map((libro) => (
                    <option key={libro.id} value={libro.id}>
                      {libro.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleAddSaldo}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Año
                <select
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addYear}
                  onChange={(event) => setAddYear(Number(event.target.value))}
                >
                  {addYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Mes
                <select
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addMonth}
                  onChange={(event) => setAddMonth(Number(event.target.value))}
                >
                  {MONTH_OPTIONS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Saldo
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addSaldo}
                  onChange={(event) => setAddSaldo(event.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-black/10 bg-black/5 px-4 py-3 text-xs text-[var(--muted)] dark:border-white/10 dark:bg-white/5">
              <span>
                Mes:{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  {formatMonth(addMesPreview)}
                </span>{" "}
                · {addMesPreview}
              </span>
            </div>

            {addSaldoError && (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                {addSaldoError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={addSaldoLoading}
                className="cursor-pointer rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-500/20 transition hover:translate-y-[-1px] hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {addSaldoLoading ? "Guardando..." : "Guardar saldo"}
              </button>
            </div>
          </form>
        </section>

        <section
          id="tabla-saldos"
          className="rounded-3xl border border-black/10 bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3
                className="text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Saldos del libro
              </h3>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Ordenados por fecha · {selectedLibro?.nombre ?? "Sin libro"}
              </p>
            </div>
            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--foreground)] shadow-sm dark:border-white/10 dark:bg-black/60">
              {`Mostrando: ${saldos.length}`}
            </span>
            {saldosLoading && (
              <span className="text-xs text-[var(--muted)]">
                Cargando saldos...
              </span>
            )}
            {saldosError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {saldosError}
              </span>
            )}
            {editError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {editError}
              </span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 text-[var(--foreground)] dark:divide-white/10">
                {saldos.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                    >
                      Sin saldos en este libro.
                    </td>
                  </tr>
                ) : (
                  saldos.map((saldo) => (
                    <tr key={saldo.id} className="hover:bg-black/5">
                      <td
                        className="px-3 py-2 whitespace-nowrap cursor-pointer"
                        onDoubleClick={() => startEdit(saldo, "mes")}
                        title="Doble click para editar"
                      >
                        {isEditing(saldo.id, "mes") ? (
                          <input
                            type="month"
                            className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                            value={editingValue}
                            onChange={(event) =>
                              setEditingValue(event.target.value)
                            }
                            onBlur={commitEdit}
                            onKeyDown={handleEditKeyDown}
                            disabled={editSaving}
                          />
                        ) : (
                          formatMonth(saldo.mes)
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-right cursor-pointer"
                        onDoubleClick={() => startEdit(saldo, "saldo")}
                        title="Doble click para editar"
                      >
                        {isEditing(saldo.id, "saldo") ? (
                          <input
                            className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                            value={editingValue}
                            onChange={(event) =>
                              setEditingValue(event.target.value)
                            }
                            onBlur={commitEdit}
                            onKeyDown={handleEditKeyDown}
                            disabled={editSaving}
                            inputMode="decimal"
                          />
                        ) : (
                          formatCurrency(Number(saldo.saldo ?? 0))
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
