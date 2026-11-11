// Avisos puramente informativos sobre una nómina ya parseada — nunca
// cambian parsingStatus ni bloquean nada, solo se muestran en el detalle
// para que el usuario sepa que algo merece un vistazo. Pensado para pillar
// deslices del parser, no para dar por buena ni mala una nómina real.

export interface PayslipValidationWarning {
  code: "amount_mismatch" | "gross_mismatch" | "below_smi";
  message: string;
}

interface ValidationInput {
  payslipType: "ordinal" | "extra";
  grossSalary: number | null;
  netSalary: number | null;
  concepts: Array<{ category: "devengo" | "deduccion" | "otros"; amount: number }>;
  /** Pagas y jornada del perfil, si se conocen. */
  profile?: { paymentsPerYear: number | null; workdayPercent: number | null };
}

// SMI 2026 en 14 pagas — Real Decreto 126/2026 (BOE-A-2026-3815), art. 1:
// 1.221 €/mes (17.094 €/año ÷ 14). No distingue jornada parcial: el aviso
// se redacta para no dar por hecho que hay un error.
export const SMI_MENSUAL_2026 = 1221;
export const SMI_ANUAL_2026 = 17_094;

/** Umbral mensual del SMI para unas pagas y una jornada (12 pagas = con las extra prorrateadas). */
export function smiMonthlyThreshold(paymentsPerYear: number | null | undefined, workdayPercent: number | null | undefined): number {
  return Math.round(((SMI_ANUAL_2026 / (paymentsPerYear ?? 14)) * (workdayPercent ?? 100)) / 100 * 100) / 100;
}

function sumByCategory(concepts: ValidationInput["concepts"], category: "devengo" | "deduccion"): number {
  return concepts.filter((c) => c.category === category).reduce((s, c) => s + c.amount, 0);
}

export function validatePayslip(input: ValidationInput): PayslipValidationWarning[] {
  const warnings: PayslipValidationWarning[] = [];
  const { grossSalary, netSalary, concepts } = input;

  if (grossSalary != null && netSalary != null && concepts.length > 0) {
    const totalDeducciones = sumByCategory(concepts, "deduccion");
    const expectedNet = grossSalary - totalDeducciones;
    const tolerance = Math.max(1, netSalary * 0.005);
    const diff = Math.abs(expectedNet - netSalary);
    if (diff > tolerance) {
      warnings.push({
        code: "amount_mismatch",
        message: `Bruto (${grossSalary.toFixed(2)} €) menos deducciones (${totalDeducciones.toFixed(2)} €) da ${expectedNet.toFixed(2)} €, pero el neto indicado es ${netSalary.toFixed(2)} € (diferencia de ${diff.toFixed(2)} €). Puede que falte revisar algún concepto.`,
      });
    }

    const totalDevengos = sumByCategory(concepts, "devengo");
    const grossDiff = Math.abs(totalDevengos - grossSalary);
    const grossTolerance = Math.max(1, grossSalary * 0.005);
    if (totalDevengos > 0 && grossDiff > grossTolerance) {
      warnings.push({
        code: "gross_mismatch",
        message: `La suma de los devengos (${totalDevengos.toFixed(2)} €) no coincide con el bruto indicado (${grossSalary.toFixed(2)} €). Puede que falte algún concepto por extraer.`,
      });
    }
  }

  // Con las pagas y la jornada del perfil, el umbral es el suyo; sin ellas, se
  // supone jornada completa en 14 pagas y el aviso se redacta con cautela.
  const profile = input.profile;
  const known = profile?.paymentsPerYear != null || profile?.workdayPercent != null;
  const threshold = smiMonthlyThreshold(profile?.paymentsPerYear, profile?.workdayPercent);
  if (input.payslipType === "ordinal" && grossSalary != null && grossSalary < threshold - 0.5) {
    const jornada = (profile?.workdayPercent ?? 100) < 100 ? `una jornada del ${profile!.workdayPercent} %` : "jornada completa";
    warnings.push({
      code: "below_smi",
      message: known
        ? `El bruto de esta nómina (${grossSalary.toFixed(2)} €) está por debajo del SMI de 2026 para ${jornada} en ${profile?.paymentsPerYear ?? 14} pagas (${threshold.toFixed(2)} €/mes). Merece la pena revisarlo con la empresa.`
        : `El bruto de esta nómina (${grossSalary.toFixed(2)} €) está por debajo del SMI a jornada completa de 2026 (${SMI_MENSUAL_2026} €/mes). Si el contrato es a tiempo parcial, o las pagas extra van aparte, esto puede ser normal: indica tus pagas y tu jornada en el perfil para afinar el aviso.`,
    });
  }

  return warnings;
}
