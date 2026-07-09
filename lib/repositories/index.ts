import { SupabaseAnalysisRepository } from "./analysis";
import { SupabaseSectorRepository } from "./sectors";
import { SupabaseKpiRepository } from "./kpis";

export const analysisRepo = new SupabaseAnalysisRepository();
export const sectorRepo = new SupabaseSectorRepository();
export const kpiRepo = new SupabaseKpiRepository();
