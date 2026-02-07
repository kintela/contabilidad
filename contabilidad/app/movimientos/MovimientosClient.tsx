"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

type Libro = {
  id: string;
  nombre: string;
  moneda: string | null;
};

type Movimiento = {
  id: string;
  fecha: string;
  tipo: string | null;
  importe: number | null;
  detalle?: string | null;
  fijo?: boolean | null;
  categoria_id?: string | null;
  categoria_nombre?: string | null;
  categoria_kind?: string | null;
  creado_en?: string | null;
};

type EditableField =
  | "fecha"
  | "categoria_id"
  | "detalle"
  | "tipo"
  | "fijo"
  | "importe";

type Categoria = {
  id: string;
  nombre: string | null;
  kind: "ingreso" | "gasto" | null;
};

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

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeKindLabel = (value?: string | null) => {
  const tipo = (value ?? "").toLowerCase().trim();
  if (!tipo) return null;
  if (
    tipo.includes("ingres") ||
    tipo.includes("income") ||
    tipo.includes("entrada") ||
    tipo.includes("abono")
  ) {
    return "ingreso" as const;
  }
  if (
    tipo.includes("gast") ||
    tipo.includes("expense") ||
    tipo.includes("salida") ||
    tipo.includes("cargo")
  ) {
    return "gasto" as const;
  }
  if (tipo === "i") return "ingreso" as const;
  if (tipo === "g") return "gasto" as const;
  return null;
};

const resolveCategoryKind = (categoria: Record<string, unknown>) => {
  const tipo = typeof categoria.tipo === "string" ? categoria.tipo : null;
  const kindFromTipo = normalizeKindLabel(tipo);
  if (kindFromTipo) return kindFromTipo;
  for (const [key, value] of Object.entries(categoria)) {
    if (typeof value !== "string") continue;
    const keyLower = key.toLowerCase();
    if (
      keyLower.includes("tipo") ||
      keyLower.includes("kind") ||
      keyLower.includes("mov")
    ) {
      const kind = normalizeKindLabel(value);
      if (kind) return kind;
    }
  }
  const esGasto =
    typeof categoria.es_gasto === "boolean"
      ? categoria.es_gasto
      : typeof categoria.esGasto === "boolean"
        ? categoria.esGasto
        : typeof categoria.gasto === "boolean"
          ? categoria.gasto
          : null;
  if (typeof esGasto === "boolean") return esGasto ? "gasto" : "ingreso";
  const esIngreso =
    typeof categoria.es_ingreso === "boolean"
      ? categoria.es_ingreso
      : typeof categoria.esIngreso === "boolean"
        ? categoria.esIngreso
        : typeof categoria.ingreso === "boolean"
          ? categoria.ingreso
          : null;
  if (typeof esIngreso === "boolean") return esIngreso ? "ingreso" : "gasto";
  for (const [key, value] of Object.entries(categoria)) {
    if (typeof value !== "boolean") continue;
    const keyLower = key.toLowerCase();
    if (keyLower.includes("gasto")) return value ? "gasto" : "ingreso";
    if (keyLower.includes("ingreso")) return value ? "ingreso" : "gasto";
  }
  return null;
};

const resolveKind = (mov: {
  tipo?: string | null;
  categoria_kind?: string | null;
}) => {
  const tipoKind = normalizeKindLabel(mov.tipo);
  if (tipoKind) return tipoKind;
  const categoryKind = normalizeKindLabel(mov.categoria_kind);
  if (categoryKind) return categoryKind;
  return null;
};

const sortMovimientos = (rows: Movimiento[]) =>
  [...rows].sort((a, b) => {
    const dateDiff =
      new Date(b.fecha).getTime() - new Date(a.fecha).getTime();
    if (dateDiff !== 0) return dateDiff;
    const createdA = a.creado_en ? new Date(a.creado_en).getTime() : 0;
    const createdB = b.creado_en ? new Date(b.creado_en).getTime() : 0;
    return createdB - createdA;
  });

type MovimientosClientProps = {
  initialLibroId?: string | null;
};

export default function MovimientosClient({
  initialLibroId = null,
}: MovimientosClientProps) {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [libros, setLibros] = useState<Libro[]>([]);
  const [librosLoading, setLibrosLoading] = useState(false);
  const [librosError, setLibrosError] = useState<string | null>(null);
  const [selectedLibroId, setSelectedLibroId] = useState<string | null>(
    initialLibroId
  );

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriasLoading, setCategoriasLoading] = useState(false);
  const [categoriasError, setCategoriasError] = useState<string | null>(null);

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [addYear, setAddYear] = useState<number>(CURRENT_YEAR);
  const [addMonth, setAddMonth] = useState<number>(CURRENT_MONTH);
  const [addDay, setAddDay] = useState("");
  const [addCategoriaId, setAddCategoriaId] = useState("");
  const [addDetalle, setAddDetalle] = useState("");
  const [addImporte, setAddImporte] = useState("");
  const [addTipo, setAddTipo] = useState<"ingreso" | "gasto">("gasto");
  const [addFijo, setAddFijo] = useState(false);
  const [addMovimientoLoading, setAddMovimientoLoading] = useState(false);
  const [addMovimientoError, setAddMovimientoError] = useState<string | null>(
    null
  );

  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [movimientosLoading, setMovimientosLoading] = useState(false);
  const [movimientosError, setMovimientosError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: EditableField;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Movimiento | null>(
    null
  );

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

      const currentId =
        selectedLibroId && ordered.some((libro) => libro.id === selectedLibroId)
          ? selectedLibroId
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
            preferredNames.includes(normalizeText(libro.nombre))
          ) ?? ordered[0];

        setSelectedLibroId(preferredLibro?.id ?? null);
      }

      setLibrosLoading(false);
    };

    loadLibros();
  }, [session, selectedLibroId]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const loadCategorias = async () => {
      setCategoriasLoading(true);
      setCategoriasError(null);

      const { data, error } = await supabase.from("categorias").select("*");

      if (error) {
        setCategoriasError(error.message);
        setCategorias([]);
        setCategoriasLoading(false);
        return;
      }

      const mapped = (data ?? []).map((categoria) => ({
        id: String(categoria.id),
        nombre:
          typeof categoria.nombre === "string" ? categoria.nombre : "Sin nombre",
        kind: resolveCategoryKind(categoria as Record<string, unknown>),
      }));

      const ordered = mapped.sort((a, b) =>
        (a.nombre ?? "").localeCompare(b.nombre ?? "", "es-ES")
      );

      setCategorias(ordered);
      setCategoriasLoading(false);
    };

    loadCategorias();
  }, [session]);

  useEffect(() => {
    if (!selectedLibroId) return;

    const loadYears = async () => {
      setMovimientosError(null);
      const pageSize = 500;
      let from = 0;
      const allRows: { fecha: string }[] = [];
      let totalCount: number | null = null;

      while (true) {
        const { data, error, count } = await supabase
          .from("movimientos")
          .select("fecha", { count: "exact" })
          .eq("libro_id", selectedLibroId)
          .range(from, from + pageSize - 1);

        if (error) {
          setMovimientosError(error.message);
          setAvailableYears([]);
          return;
        }

        if (totalCount === null && typeof count === "number") {
          totalCount = count;
        }

        if (data && data.length > 0) {
          allRows.push(...data);
        }

        if (!data || data.length === 0) break;
        from += pageSize;

        if (totalCount !== null && allRows.length >= totalCount) break;
        if (data.length < pageSize && totalCount === null) break;
      }

      const years = Array.from(
        new Set(
          allRows
            .map((row) => {
              if (typeof row.fecha === "string") {
                const rawYear = Number(row.fecha.slice(0, 4));
                return Number.isFinite(rawYear)
                  ? rawYear
                  : new Date(row.fecha).getFullYear();
              }
              return new Date(row.fecha).getFullYear();
            })
            .filter((year) => Number.isFinite(year))
        )
      ).sort((a, b) => b - a);

      setAvailableYears(years);
      setAddYear((prev) => {
        if (years.includes(prev)) return prev;
        if (years.includes(CURRENT_YEAR)) return CURRENT_YEAR;
        return years[0] ?? CURRENT_YEAR;
      });
    };

    loadYears();
  }, [selectedLibroId, refreshToken]);

  useEffect(() => {
    if (!selectedLibroId) return;

    const loadMovimientos = async () => {
      setMovimientosLoading(true);
      setMovimientosError(null);

      const { data, error } = await supabase
        .from("movimientos")
        .select(
          "id, fecha, tipo, importe, detalle, fijo, categoria_id, creado_en"
        )
        .eq("libro_id", selectedLibroId)
        .order("fecha", { ascending: false })
        .order("creado_en", { ascending: false });

      if (error) {
        setMovimientosError(error.message);
        setMovimientos([]);
        setMovimientosLoading(false);
        return;
      }

      const categoriaMap = new Map(
        categorias.map((categoria) => [categoria.id, categoria])
      );

      const enriched = (data ?? []).map((mov) => ({
        ...mov,
        categoria_nombre: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.nombre ?? null
          : null,
        categoria_kind: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.kind ?? null
          : null,
      }));

      setMovimientos(sortMovimientos(enriched));
      setMovimientosLoading(false);
    };

    loadMovimientos();
  }, [selectedLibroId, categorias, refreshToken]);

  const addYearOptions = useMemo(() => {
    const set = new Set<number>(availableYears);
    set.add(CURRENT_YEAR);
    return Array.from(set).sort((a, b) => b - a);
  }, [availableYears]);

  const detailOptions = useMemo(() => {
    const set = new Set<string>();
    movimientos.forEach((mov) => {
      if (typeof mov.detalle === "string" && mov.detalle.trim()) {
        set.add(mov.detalle.trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es-ES"));
  }, [movimientos]);

  const selectedLibro = libros.find((libro) => libro.id === selectedLibroId);
  const currency = selectedLibro?.moneda ?? "EUR";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(value));

  const formatMovementAmount = (mov: Movimiento) => {
    const amount = Number(mov.importe ?? 0);
    const kind = resolveKind(mov);
    const normalized =
      kind === "gasto" ? -Math.abs(amount) : Math.abs(amount);
    return formatCurrency(normalized);
  };

  const addFechaPreview = useMemo(() => {
    const dayValue = Number(addDay);
    if (!addDay || !Number.isInteger(dayValue)) return null;
    const date = new Date(addYear, addMonth - 1, dayValue);
    if (
      date.getFullYear() !== addYear ||
      date.getMonth() !== addMonth - 1 ||
      date.getDate() !== dayValue
    ) {
      return null;
    }
    const month = String(addMonth).padStart(2, "0");
    const day = String(dayValue).padStart(2, "0");
    return `${addYear}-${month}-${day}`;
  }, [addYear, addMonth, addDay]);

  const parseImporteValue = (value: string) => {
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

  const parseDateInput = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const [year, month, day] = trimmed.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return trimmed;
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditingValue("");
    setEditError(null);
  };

  const startEdit = (mov: Movimiento, field: EditableField) => {
    if (editSaving) return;
    if (editingCell?.id === mov.id && editingCell.field === field) return;
    setEditError(null);
    setEditingCell({ id: mov.id, field });
    switch (field) {
      case "fecha":
        setEditingValue(mov.fecha?.slice(0, 10) ?? "");
        break;
      case "categoria_id":
        setEditingValue(mov.categoria_id ?? "");
        break;
      case "detalle":
        setEditingValue(mov.detalle ?? "");
        break;
      case "tipo":
        setEditingValue(mov.tipo ?? "");
        break;
      case "fijo":
        setEditingValue(mov.fijo ? "si" : "no");
        break;
      case "importe":
        setEditingValue(
          Number.isFinite(Number(mov.importe ?? 0))
            ? String(mov.importe ?? "")
            : ""
        );
        break;
      default:
        setEditingValue("");
    }
  };

  const commitEdit = async () => {
    if (!editingCell) return;
    if (editSaving) return;
    const target = movimientos.find((mov) => mov.id === editingCell.id);
    if (!target) {
      cancelEdit();
      return;
    }

    const updates: Partial<Movimiento> = {};
    const payload: Record<string, unknown> = {};

    switch (editingCell.field) {
      case "fecha": {
        const nextDate = parseDateInput(editingValue);
        if (!nextDate) {
          setEditError("La fecha no es válida.");
          return;
        }
        payload.fecha = nextDate;
        updates.fecha = nextDate;
        break;
      }
      case "categoria_id": {
        if (!editingValue) {
          setEditError("Selecciona una categoría.");
          return;
        }
        payload.categoria_id = editingValue;
        updates.categoria_id = editingValue;
        const categoriaLookup = categorias.find(
          (categoria) => categoria.id === editingValue
        );
        updates.categoria_nombre = categoriaLookup?.nombre ?? null;
        updates.categoria_kind = categoriaLookup?.kind ?? null;
        break;
      }
      case "detalle": {
        const nextDetail = editingValue.trim();
        payload.detalle = nextDetail ? nextDetail : null;
        updates.detalle = nextDetail ? nextDetail : null;
        break;
      }
      case "tipo": {
        if (editingValue !== "ingreso" && editingValue !== "gasto") {
          setEditError("Selecciona un tipo válido.");
          return;
        }
        payload.tipo = editingValue;
        updates.tipo = editingValue as "ingreso" | "gasto";
        break;
      }
      case "fijo": {
        const nextFijo = editingValue === "si";
        payload.fijo = nextFijo;
        updates.fijo = nextFijo;
        break;
      }
      case "importe": {
        const importeValue = parseImporteValue(editingValue);
        if (importeValue === null) {
          setEditError("Introduce un importe válido.");
          return;
        }
        if (importeValue < 0) {
          setEditError("El importe debe ser mayor o igual a cero.");
          return;
        }
        payload.importe = importeValue;
        updates.importe = importeValue;
        break;
      }
      default:
        break;
    }

    if (Object.keys(payload).length === 0) {
      cancelEdit();
      return;
    }

    setEditSaving(true);

    const { data, error } = await supabase
      .from("movimientos")
      .update(payload)
      .eq("id", target.id)
      .select(
        "id, fecha, tipo, importe, detalle, fijo, categoria_id, creado_en"
      )
      .single();

    if (error) {
      setEditError(error.message);
      setEditSaving(false);
      return;
    }

    const categoriaLookup = categorias.find(
      (categoria) => categoria.id === data.categoria_id
    );
    const enriched: Movimiento = {
      ...data,
      categoria_nombre: categoriaLookup?.nombre ?? null,
      categoria_kind: categoriaLookup?.kind ?? null,
    };

    setMovimientos((prev) =>
      sortMovimientos(
        prev.map((mov) => (mov.id === target.id ? enriched : mov))
      )
    );

    setEditSaving(false);
    cancelEdit();
  };

  const handleEditKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>
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

  const isEditing = (id: string, field: EditableField) =>
    editingCell?.id === id && editingCell.field === field;

  const handleDeleteMovimiento = (mov: Movimiento) => {
    if (deleteLoadingId) return;
    setDeleteError(null);
    setDeleteCandidate(mov);
  };

  const handleCloseDeleteModal = () => {
    if (deleteLoadingId) return;
    setDeleteCandidate(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate || deleteLoadingId) return;
    setDeleteError(null);
    setDeleteLoadingId(deleteCandidate.id);

    const { error } = await supabase
      .from("movimientos")
      .delete()
      .eq("id", deleteCandidate.id);

    if (error) {
      setDeleteError(error.message);
      setDeleteLoadingId(null);
      return;
    }

    setMovimientos((prev) =>
      prev.filter((item) => item.id !== deleteCandidate.id)
    );
    setDeleteLoadingId(null);
    setDeleteCandidate(null);
  };

  const resetAddMovimientoForm = () => {
    setAddDay("");
    setAddCategoriaId("");
    setAddDetalle("");
    setAddImporte("");
    setAddTipo("gasto");
    setAddFijo(false);
    setAddMovimientoError(null);
  };

  const handleAddMovimiento = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setAddMovimientoError(null);

    if (!selectedLibroId) {
      setAddMovimientoError("Selecciona un libro antes de añadir movimientos.");
      return;
    }

    if (!addFechaPreview) {
      setAddMovimientoError("La fecha no es válida.");
      return;
    }

    if (!addCategoriaId) {
      setAddMovimientoError("Selecciona una categoría.");
      return;
    }

    const importeValue = parseImporteValue(addImporte);
    if (importeValue === null) {
      setAddMovimientoError("Introduce un importe válido.");
      return;
    }
    if (importeValue < 0) {
      setAddMovimientoError("El importe debe ser mayor o igual a cero.");
      return;
    }

    setAddMovimientoLoading(true);

    const { data, error } = await supabase
      .from("movimientos")
      .insert({
        libro_id: selectedLibroId,
        fecha: addFechaPreview,
        categoria_id: addCategoriaId,
        tipo: addTipo,
        fijo: addFijo,
        importe: importeValue,
        detalle: addDetalle.trim() ? addDetalle.trim() : null,
      })
      .select(
        "id, fecha, tipo, importe, detalle, fijo, categoria_id, creado_en"
      )
      .single();

    if (error) {
      setAddMovimientoError(error.message);
      setAddMovimientoLoading(false);
      return;
    }

    const categoriaLookup = categorias.find(
      (categoria) => categoria.id === addCategoriaId
    );
    const enriched: Movimiento = {
      ...data,
      categoria_nombre: categoriaLookup?.nombre ?? null,
      categoria_kind: categoriaLookup?.kind ?? null,
    };

    setMovimientos((prev) => sortMovimientos([enriched, ...prev]));

    setAddMovimientoLoading(false);
    resetAddMovimientoForm();
    setRefreshToken((prev) => prev + 1);
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
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
              Movimientos
            </p>
            <h1
              className="mt-2 text-4xl font-semibold leading-tight text-[var(--foreground)] sm:text-5xl"
              style={{ fontFamily: "var(--font-fraunces)" }}
            >
              Añadir movimientos
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Libro · {selectedLibro?.nombre ?? "Sin libro seleccionado"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
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
                Nuevo movimiento
              </h2>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Completa el formulario y guarda
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

          <form className="mt-6 space-y-4" onSubmit={handleAddMovimiento}>
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
                Día
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addDay}
                  onChange={(event) => setAddDay(event.target.value)}
                  inputMode="numeric"
                  placeholder="1-31"
                />
              </label>
            </div>

            <div className="rounded-2xl border border-black/10 bg-black/5 px-4 py-3 text-xs text-[var(--muted)] dark:border-white/10 dark:bg-white/5">
              {addFechaPreview ? (
                <span>
                  Fecha:{" "}
                  <span className="font-semibold text-[var(--foreground)]">
                    {formatDate(addFechaPreview)}
                  </span>{" "}
                  · {addFechaPreview}
                </span>
              ) : (
                <span>Completa año, mes y día para fijar la fecha.</span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Categoría
                <select
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-black/60"
                  value={addCategoriaId}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAddCategoriaId(value);
                    const selectedCategory = categorias.find(
                      (item) => item.id === value
                    );
                    if (selectedCategory?.kind) {
                      setAddTipo(selectedCategory.kind);
                    }
                  }}
                  disabled={categoriasLoading || categorias.length === 0}
                >
                  <option value="">
                    {categoriasLoading
                      ? "Cargando categorías..."
                      : "Selecciona una categoría"}
                  </option>
                  {categorias.map((categoria) => (
                    <option key={categoria.id} value={categoria.id}>
                      {categoria.nombre ?? "Sin nombre"}
                    </option>
                  ))}
                </select>
                {categoriasError && (
                  <span className="mt-2 block text-[11px] text-red-600 dark:text-red-300">
                    {categoriasError}
                  </span>
                )}
              </label>
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Detalle
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addDetalle}
                  onChange={(event) => setAddDetalle(event.target.value)}
                  placeholder="Descripción"
                  list="detalle-opciones"
                />
                <datalist id="detalle-opciones">
                  {detailOptions.map((detalle) => (
                    <option key={detalle} value={detalle} />
                  ))}
                </datalist>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Importe
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addImporte}
                  onChange={(event) => setAddImporte(event.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Tipo
                <select
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addTipo}
                  onChange={(event) =>
                    setAddTipo(event.target.value as "ingreso" | "gasto")
                  }
                >
                  <option value="ingreso">Ingreso</option>
                  <option value="gasto">Gasto</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-[var(--foreground)]">
                Fijo
                <select
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={addFijo ? "si" : "no"}
                  onChange={(event) => setAddFijo(event.target.value === "si")}
                >
                  <option value="no">No</option>
                  <option value="si">Sí</option>
                </select>
              </label>
            </div>

            {addMovimientoError && (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                {addMovimientoError}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={resetAddMovimientoForm}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:border-white/10"
              >
                Limpiar
              </button>
              <button
                type="submit"
                disabled={addMovimientoLoading}
                className="cursor-pointer rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-emerald-500/20 transition hover:translate-y-[-1px] hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {addMovimientoLoading ? "Guardando..." : "Guardar movimiento"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3
                className="text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Movimientos del libro
              </h3>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Ordenados por fecha · {selectedLibro?.nombre ?? "Sin libro"}
              </p>
            </div>
            <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--foreground)] shadow-sm dark:border-white/10 dark:bg-black/60">
              Total: {movimientos.length}
            </span>
            {movimientosLoading && (
              <span className="text-xs text-[var(--muted)]">
                Cargando movimientos...
              </span>
            )}
            {movimientosError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {movimientosError}
              </span>
            )}
            {editError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {editError}
              </span>
            )}
            {deleteError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {deleteError}
              </span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Categoría</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Fijo</th>
                  <th className="px-3 py-2 text-right">Importe</th>
                  <th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 text-[var(--foreground)] dark:divide-white/10">
                {movimientos.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                    >
                      Sin movimientos en este libro.
                    </td>
                  </tr>
                ) : (
                  movimientos.map((mov) => {
                    const kind = resolveKind(mov);
                    const kindLabel =
                      kind === "ingreso"
                        ? "Ingreso"
                        : kind === "gasto"
                          ? "Gasto"
                          : "-";
                    return (
                      <tr key={mov.id} className="hover:bg-black/5">
                        <td
                          className="px-3 py-2 whitespace-nowrap cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "fecha")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "fecha") ? (
                            <input
                              type="date"
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
                            formatDate(mov.fecha)
                          )}
                        </td>
                        <td
                          className="px-3 py-2 cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "categoria_id")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "categoria_id") ? (
                            <select
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              onBlur={commitEdit}
                              onKeyDown={handleEditKeyDown}
                              disabled={
                                editSaving ||
                                categoriasLoading ||
                                categorias.length === 0
                              }
                            >
                              <option value="">
                                {categoriasLoading
                                  ? "Cargando..."
                                  : "Selecciona"}
                              </option>
                              {categorias.map((categoria) => (
                                <option key={categoria.id} value={categoria.id}>
                                  {categoria.nombre ?? "Sin nombre"}
                                </option>
                              ))}
                            </select>
                          ) : (
                            mov.categoria_nombre ?? "Sin categoría"
                          )}
                        </td>
                        <td
                          className="px-3 py-2 cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "detalle")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "detalle") ? (
                            <input
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              onBlur={commitEdit}
                              onKeyDown={handleEditKeyDown}
                              disabled={editSaving}
                              list="detalle-opciones"
                            />
                          ) : (
                            mov.detalle ?? "—"
                          )}
                        </td>
                        <td
                          className="px-3 py-2 cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "tipo")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "tipo") ? (
                            <select
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              onBlur={commitEdit}
                              onKeyDown={handleEditKeyDown}
                              disabled={editSaving}
                            >
                              <option value="">Selecciona</option>
                              <option value="ingreso">Ingreso</option>
                              <option value="gasto">Gasto</option>
                            </select>
                          ) : (
                            kindLabel
                          )}
                        </td>
                        <td
                          className="px-3 py-2 cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "fijo")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "fijo") ? (
                            <select
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                              value={editingValue}
                              onChange={(event) =>
                                setEditingValue(event.target.value)
                              }
                              onBlur={commitEdit}
                              onKeyDown={handleEditKeyDown}
                              disabled={editSaving}
                            >
                              <option value="no">No</option>
                              <option value="si">Sí</option>
                            </select>
                          ) : (
                            (mov.fijo ? "Sí" : "No")
                          )}
                        </td>
                        <td
                          className="px-3 py-2 text-right cursor-pointer"
                          onDoubleClick={() => startEdit(mov, "importe")}
                          title="Doble click para editar"
                        >
                          {isEditing(mov.id, "importe") ? (
                            <input
                              className="w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-right text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
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
                            formatMovementAmount(mov)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteMovimiento(mov)}
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-transparent text-[var(--muted)] transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Eliminar movimiento"
                            disabled={deleteLoadingId === mov.id}
                          >
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M6 6l1 14h10l1-14" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={handleCloseDeleteModal}
            aria-hidden="true"
          />
          <div
            className="relative w-full max-w-md rounded-3xl border border-black/10 bg-[var(--surface)] p-6 shadow-[0_40px_120px_rgba(15,23,42,0.25)] dark:border-white/10"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar eliminación"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-2xl font-semibold text-[var(--foreground)]"
                  style={{ fontFamily: "var(--font-fraunces)" }}
                >
                  Eliminar movimiento
                </h2>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                  Esta acción no se puede deshacer
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                className="rounded-full border border-black/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:border-white/10"
                disabled={deleteLoadingId === deleteCandidate.id}
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-black/10 bg-black/5 px-4 py-3 text-sm text-[var(--foreground)] dark:border-white/10 dark:bg-white/5">
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Detalles
              </div>
              <div className="mt-2 space-y-1 text-sm">
                <div>
                  <span className="text-[var(--muted)]">Fecha:</span>{" "}
                  {formatDate(deleteCandidate.fecha)}
                </div>
                <div>
                  <span className="text-[var(--muted)]">Categoría:</span>{" "}
                  {deleteCandidate.categoria_nombre ?? "Sin categoría"}
                </div>
                <div>
                  <span className="text-[var(--muted)]">Detalle:</span>{" "}
                  {deleteCandidate.detalle ?? "Sin detalle"}
                </div>
                <div>
                  <span className="text-[var(--muted)]">Importe:</span>{" "}
                  {formatMovementAmount(deleteCandidate)}
                </div>
              </div>
            </div>

            {deleteError && (
              <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                {deleteError}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCloseDeleteModal}
                className="cursor-pointer rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed dark:border-white/10"
                disabled={deleteLoadingId === deleteCandidate.id}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteLoadingId === deleteCandidate.id}
                className="cursor-pointer rounded-full bg-rose-600 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-rose-500/20 transition hover:translate-y-[-1px] hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deleteLoadingId === deleteCandidate.id
                  ? "Eliminando..."
                  : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
