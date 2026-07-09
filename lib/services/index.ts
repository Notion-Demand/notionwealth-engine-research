import { sectorRepo, kpiRepo, analysisRepo } from "@/lib/repositories";
import { SectorThesisService } from "./sectorThesisService";

export const sectorThesisService = new SectorThesisService({ sectorRepo, kpiRepo, analysisRepo });
