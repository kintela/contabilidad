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

type Categoria = {
  id: string;
  nombre: string | null;
  kind: "ingreso" | "gasto" | null;
};

type GastoMovimiento = {
  id: string;
  fecha: string;
  amount: number;
  libro_id: string;
  detalle?: string | null;
  categoria_nombre?: string | null;
};

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const MOVIMIENTOS_GASTOS_PAGE_SIZE = 1000;
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

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriasLoading, setCategoriasLoading] = useState(false);
  const [categoriasError, setCategoriasError] = useState<string | null>(null);

  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [saldosLoading, setSaldosLoading] = useState(false);
  const [saldosError, setSaldosError] = useState<string | null>(null);

  const [gastoMovimientos, setGastoMovimientos] = useState<GastoMovimiento[]>(
    []
  );
  const [gastoMovimientosLoading, setGastoMovimientosLoading] =
    useState(false);
  const [gastoMovimientosError, setGastoMovimientosError] = useState<
    string | null
  >(null);

  const [addYear, setAddYear] = useState<number>(CURRENT_YEAR);
  const [addMonth, setAddMonth] = useState<number>(CURRENT_MONTH);
  const [addSaldo, setAddSaldo] = useState("");
  const [addSaldoLoading, setAddSaldoLoading] = useState(false);
  const [addSaldoError, setAddSaldoError] = useState<string | null>(null);

  const [chartYear, setChartYear] = useState<string>(
    String(CURRENT_YEAR)
  );

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
    if (!session?.user?.id) return;
    if (!selectedLibroId) return;

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

  useEffect(() => {
    if (!session?.user?.id) return;
    if (!selectedLibroId) return;
    if (categoriasLoading) return;

    let isMounted = true;

    const loadGastoMovimientos = async () => {
      setGastoMovimientosLoading(true);
      setGastoMovimientosError(null);

      const categoriaMap = new Map(
        categorias.map((categoria) => [categoria.id, categoria])
      );

      const allRows: GastoMovimiento[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("movimientos")
          .select("id, fecha, tipo, importe, detalle, categoria_id, creado_en")
          .eq("libro_id", selectedLibroId)
          .order("fecha", { ascending: false })
          .order("creado_en", { ascending: false })
          .range(from, from + MOVIMIENTOS_GASTOS_PAGE_SIZE - 1);

        if (error) {
          if (!isMounted) return;
          setGastoMovimientosError(error.message);
          setGastoMovimientos([]);
          setGastoMovimientosLoading(false);
          return;
        }

        if (!data || data.length === 0) break;

        data.forEach((mov) => {
          const amountValue = Number(mov.importe ?? 0);
          if (!Number.isFinite(amountValue) || amountValue === 0) return;

          const categoria = mov.categoria_id
            ? categoriaMap.get(mov.categoria_id)
            : null;
          const kind = resolveKind({
            tipo: mov.tipo,
            categoria_kind: categoria?.kind ?? null,
          });

          if (kind !== "gasto") return;

          allRows.push({
            id: String(mov.id),
            fecha: mov.fecha,
            amount: Math.abs(amountValue),
            libro_id: selectedLibroId,
            detalle: mov.detalle ?? null,
            categoria_nombre: categoria?.nombre ?? null,
          });
        });

        if (data.length < MOVIMIENTOS_GASTOS_PAGE_SIZE) break;
        from += MOVIMIENTOS_GASTOS_PAGE_SIZE;
      }

      if (!isMounted) return;
      setGastoMovimientos(allRows);
      setGastoMovimientosLoading(false);
    };

    loadGastoMovimientos();

    return () => {
      isMounted = false;
    };
  }, [session, selectedLibroId, categorias, categoriasLoading]);

  const selectedLibro = libros.find((libro) => libro.id === selectedLibroId);
  const currency = selectedLibro?.moneda ?? "EUR";
  const hasSelectedLibro = Boolean(selectedLibroId);
  const visibleSaldos = useMemo(() => {
    if (!selectedLibroId) return [];
    return saldos.filter((saldo) => saldo.libro_id === selectedLibroId);
  }, [saldos, selectedLibroId]);
  const visibleSaldosError = hasSelectedLibro ? saldosError : null;
  const visibleSaldosLoading = hasSelectedLibro ? saldosLoading : false;
  const visibleGastoMovimientos = useMemo(() => {
    if (!selectedLibroId) return [];
    return gastoMovimientos.filter((mov) => mov.libro_id === selectedLibroId);
  }, [gastoMovimientos, selectedLibroId]);
  const visibleGastoLoading = hasSelectedLibro ? gastoMovimientosLoading : false;
  const gastoErrorMessage = hasSelectedLibro
    ? gastoMovimientosError ?? categoriasError
    : null;

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

  const formatMonthShort = (value: string) =>
    new Intl.DateTimeFormat("es-ES", {
      year: "2-digit",
      month: "short",
    }).format(new Date(value));

  const addMesPreview = useMemo(() => {
    const month = String(addMonth).padStart(2, "0");
    return `${addYear}-${month}-01`;
  }, [addYear, addMonth]);

  const addYearOptions = useMemo(() => {
    return [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];
  }, []);

  const chartYearOptions = useMemo(() => {
    const set = new Set<number>();
    set.add(CURRENT_YEAR);
    visibleSaldos.forEach((saldo) => {
      const year = new Date(saldo.mes).getFullYear();
      if (!Number.isNaN(year)) {
        set.add(year);
      }
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [visibleSaldos]);

  const chartRows = useMemo(() => {
    return [...visibleSaldos]
      .sort(
        (a, b) => new Date(a.mes).getTime() - new Date(b.mes).getTime()
      )
      .map((row) => ({
        id: row.id,
        mes: row.mes,
        label: formatMonthShort(row.mes),
        value: Number(row.saldo ?? 0),
      }));
  }, [visibleSaldos]);

  const chartRowsByMonth = useMemo(() => {
    const map = new Map<string, number>();
    chartRows.forEach((row) => {
      map.set(row.mes.slice(0, 7), row.value);
    });
    return map;
  }, [chartRows]);

  const chartTimeline = useMemo(() => {
    if (chartYear === "all") return chartRows;
    const yearValue = Number(chartYear);
    if (!Number.isFinite(yearValue)) return chartRows;
    return Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      const mes = `${yearValue}-${month}-01`;
      const key = `${yearValue}-${month}`;
      const value = chartRowsByMonth.get(key);
      return {
        id: key,
        mes,
        label: formatMonthShort(mes),
        value: value ?? null,
      };
    });
  }, [chartYear, chartRows, chartRowsByMonth]);

  const lineChart = useMemo(() => {
    if (chartTimeline.length === 0) return null;
    const width = Math.max(720, chartTimeline.length * 84);
    const height = 260;
    const padding = { top: 32, right: 72, bottom: 48, left: 76 };
    const values = chartTimeline
      .map((row) => row.value)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    const maxValue = Math.max(0, ...values);
    const minValue = Math.min(0, ...values);
    const range = Math.max(1, maxValue - minValue);
    const rangeX = width - padding.left - padding.right;
    const rangeY = height - padding.top - padding.bottom;
    const xStep =
      chartTimeline.length > 1 ? rangeX / (chartTimeline.length - 1) : 0;
    const points = chartTimeline.map((row, index) => {
      const x =
        chartTimeline.length > 1
          ? padding.left + index * xStep
          : padding.left + rangeX / 2;
      if (typeof row.value !== "number") {
        return { ...row, x, y: null };
      }
      const y = padding.top + ((maxValue - row.value) / range) * rangeY;
      return { ...row, x, y };
    });
    let path = "";
    let drawing = false;
    points.forEach((point) => {
      if (typeof point.y !== "number") {
        drawing = false;
        return;
      }
      path += `${drawing ? " L" : " M"} ${point.x} ${point.y}`;
      drawing = true;
    });
    const zeroY = padding.top + ((maxValue - 0) / range) * rangeY;
    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
      const ratio = index / tickCount;
      const value = maxValue - ratio * (maxValue - minValue);
      return {
        value,
        y: padding.top + ratio * rangeY,
      };
    });
    return { width, height, padding, points, path, zeroY, ticks, rangeY };
  }, [chartTimeline]);

  const chartShouldScroll = useMemo(() => {
    return chartYear === "all" && chartTimeline.length > 12;
  }, [chartTimeline.length, chartYear]);

  const gastosByMonth = useMemo(() => {
    const map = new Map<
      string,
      {
        total: number;
        items: { id: string; amount: number; label: string }[];
      }
    >();

    visibleGastoMovimientos.forEach((mov) => {
      const monthKey = mov.fecha.slice(0, 7);
      if (!monthKey) return;
      const label =
        mov.detalle?.trim() || mov.categoria_nombre?.trim() || "Gasto";
      const entry = map.get(monthKey) ?? { total: 0, items: [] };
      entry.total += mov.amount;
      entry.items.push({ id: mov.id, amount: mov.amount, label });
      map.set(monthKey, entry);
    });

    const output = new Map<
      string,
      {
        total: number;
        items: { id: string; amount: number; label: string }[];
      }
    >();

    map.forEach((entry, key) => {
      const sorted = [...entry.items].sort((a, b) => b.amount - a.amount);
      output.set(key, {
        total: entry.total,
        items: sorted,
      });
    });

    return output;
  }, [visibleGastoMovimientos]);

  const gastoChart = useMemo(() => {
    if (!lineChart) return null;
    const xStep =
      lineChart.points.length > 1
        ? lineChart.points[1].x - lineChart.points[0].x
        : 0;
    const barWidth =
      lineChart.points.length > 1
        ? Math.max(6, Math.min(22, xStep * 0.55))
        : 22;
    const barAreaHeight = Math.max(
      32,
      Math.min(80, lineChart.rangeY * 0.35)
    );
    const baseY = lineChart.height - lineChart.padding.bottom - 2;
    const bars = lineChart.points.map((point) => {
      const monthKey = point.mes.slice(0, 7);
      const summary = gastosByMonth.get(monthKey);
      return {
        id: point.id,
        mes: point.mes,
        label: point.label,
        x: point.x,
        total: summary?.total ?? 0,
        items: summary?.items ?? [],
      };
    });
    const maxTotal = Math.max(0, ...bars.map((bar) => bar.total));
    return { barWidth, barAreaHeight, baseY, bars, maxTotal };
  }, [lineChart, gastosByMonth]);

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

        <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3
                className="text-2xl font-semibold text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Evolución del saldo
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <span>Año</span>
                <select
                  className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  value={chartYear}
                  onChange={(event) => setChartYear(event.target.value)}
                >
                  <option value="all">Todos</option>
                  {chartYearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--foreground)] shadow-sm dark:border-white/10 dark:bg-black/60">
                {`Meses: ${chartTimeline.length}`}
              </span>
            </div>
          </div>

          <div className="mt-6">
            {!lineChart ? (
              <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                No hay saldos para mostrar en el gráfico.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Gastos del mes</span>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-sm bg-[var(--accent)] opacity-90" />
                      Mayor
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-sm bg-[var(--accent)] opacity-30" />
                      Menor
                    </span>
                  </div>
                  {visibleGastoLoading && (
                    <span className="text-[10px]">Cargando gastos...</span>
                  )}
                  {gastoErrorMessage && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[10px] text-red-700 normal-case tracking-normal dark:text-red-300">
                      {gastoErrorMessage}
                    </span>
                  )}
                  {gastoChart &&
                    gastoChart.maxTotal === 0 &&
                    !visibleGastoLoading &&
                    !gastoErrorMessage &&
                    !categoriasLoading && (
                      <span className="text-[10px] normal-case tracking-normal text-[var(--muted)]">
                        No hay gastos para estos meses.
                      </span>
                    )}
                </div>
                <div
                  className="overflow-x-auto pb-2"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <div
                    className="relative"
                    style={{
                      minWidth: chartShouldScroll
                        ? `${lineChart.width}px`
                        : "100%",
                    }}
                  >
                  <svg
                    width={chartShouldScroll ? lineChart.width : "100%"}
                    height={lineChart.height}
                    viewBox={`0 0 ${lineChart.width} ${lineChart.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="block"
                  >
                    <g>
                      {lineChart.ticks.map((tick, index) => (
                        <g key={`${tick.value}-${index}`}>
                          <line
                            x1={lineChart.padding.left}
                            x2={lineChart.width - lineChart.padding.right}
                            y1={tick.y}
                            y2={tick.y}
                            stroke="currentColor"
                            strokeWidth="1"
                            className="text-black/10 dark:text-white/10"
                          />
                          <text
                            x={lineChart.padding.left - 12}
                            y={tick.y + 4}
                            textAnchor="end"
                            className="text-[10px] text-[var(--muted)]"
                            fill="currentColor"
                          >
                            {formatCurrency(tick.value)}
                          </text>
                        </g>
                      ))}
                      {gastoChart && gastoChart.maxTotal > 0 && (
                        <g>
                          {gastoChart.bars.map((bar) => {
                            if (bar.total <= 0 || gastoChart.maxTotal <= 0) {
                              return null;
                            }
                            const barHeight =
                              (bar.total / gastoChart.maxTotal) *
                              gastoChart.barAreaHeight;
                            if (barHeight <= 0) return null;
                            const baseY = gastoChart.baseY;
                            const x = bar.x - gastoChart.barWidth / 2;
                            const maxTooltipItems = 12;
                            const titleLines = [
                              `${formatMonth(bar.mes)} · Total gastos: ${formatCurrency(
                                bar.total
                              )}`,
                              ...bar.items
                                .slice(0, maxTooltipItems)
                                .map(
                                  (item) =>
                                    `${item.label}: ${formatCurrency(
                                      item.amount
                                    )}`
                                ),
                            ];
                            if (bar.items.length > maxTooltipItems) {
                              titleLines.push(
                                `+${bar.items.length - maxTooltipItems} más`
                              );
                            }
                            let currentY = baseY;
                            const segments = bar.items.map((item, index) => {
                              const isLast = index === bar.items.length - 1;
                              const proportionalHeight =
                                (item.amount / bar.total) * barHeight;
                              const segmentHeight = isLast
                                ? Math.max(0, currentY - (baseY - barHeight))
                                : proportionalHeight;
                              if (segmentHeight <= 0) return null;
                              currentY -= segmentHeight;
                              const ratio =
                                bar.items.length > 1
                                  ? index / (bar.items.length - 1)
                                  : 0;
                              const opacity = 0.9 - ratio * 0.6;
                              return (
                                <rect
                                  key={`${bar.id}-${item.id}`}
                                  x={x}
                                  y={currentY}
                                  width={gastoChart.barWidth}
                                  height={segmentHeight}
                                  fill="var(--accent)"
                                  opacity={opacity}
                                />
                              );
                            });
                            return (
                              <g key={`gasto-${bar.id}`}>
                                {segments}
                                <title>{titleLines.join("\n")}</title>
                              </g>
                            );
                          })}
                        </g>
                      )}
                      <line
                        x1={lineChart.padding.left}
                        x2={lineChart.width - lineChart.padding.right}
                        y1={lineChart.zeroY}
                        y2={lineChart.zeroY}
                        stroke="currentColor"
                        strokeWidth="1"
                        className="text-black/30 dark:text-white/20"
                      />
                    </g>
                    <path
                      d={lineChart.path}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2.5"
                    />
                    {lineChart.points.map((point, index) => {
                      if (typeof point.y !== "number" || point.value === null) {
                        return null;
                      }
                      const labelOffset = 12;
                      const topLimit = lineChart.padding.top + 6;
                      const bottomLimit =
                        lineChart.height - lineChart.padding.bottom - 6;
                      let labelY = point.y - labelOffset;
                      if (labelY < topLimit) {
                        labelY = point.y + labelOffset + 2;
                      }
                      if (labelY > bottomLimit) {
                        labelY = point.y - labelOffset;
                      }
                      const isFirst = index === 0;
                      const isLast = index === lineChart.points.length - 1;
                      const textAnchor = isFirst
                        ? "start"
                        : isLast
                          ? "end"
                          : "middle";
                      return (
                        <g key={point.id}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r="4"
                            fill="var(--accent)"
                          />
                          <text
                            x={point.x}
                            y={labelY}
                            textAnchor={textAnchor}
                            className="text-[10px] font-semibold text-[var(--muted)]"
                            fill="currentColor"
                          >
                            {formatCurrency(point.value)}
                          </text>
                          <title>{`${formatMonth(point.mes)} · ${formatCurrency(
                            point.value
                          )}`}</title>
                        </g>
                      );
                    })}
                    {lineChart.points.map((point, index) => {
                      const isFirst = index === 0;
                      const isLast = index === lineChart.points.length - 1;
                      const textAnchor = isFirst
                        ? "start"
                        : isLast
                          ? "end"
                          : "middle";
                      return (
                        <text
                          key={`${point.id}-label`}
                          x={point.x}
                          y={lineChart.height - 12}
                          textAnchor={textAnchor}
                          className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
                          fill="currentColor"
                        >
                          {point.label}
                        </text>
                      );
                    })}
                  </svg>
                  </div>
                </div>
              </div>
            )}
          </div>
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
              {`Mostrando: ${visibleSaldos.length}`}
            </span>
            {visibleSaldosLoading && (
              <span className="text-xs text-[var(--muted)]">
                Cargando saldos...
              </span>
            )}
            {visibleSaldosError && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                {visibleSaldosError}
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
                {visibleSaldos.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                    >
                      Sin saldos en este libro.
                    </td>
                  </tr>
                ) : (
                  visibleSaldos.map((saldo) => (
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
