import { describe, expect, it } from "vitest";
import { detectPayslipType } from "./concept-matcher.js";
import { matchConcepts } from "./formats/index.js";

describe("matchConcepts type2", () => {
  it("uses the rightmost amount for devengos and avoids synthetic deductions", () => {
    // Formato tal como lo entrega el extractor posicional (pdfjs-dist): una
    // fila lógica por línea, celdas separadas por 2+ espacios — no el
    // volcado fragmentado por "│" de pdf-parse (ya retirado).
    const rawText = [
      "NOMINA MENSUAL, JULIO",
      "Del 01/07/2025 al 31/07/2025",
      "P Concepto Cantidad T Precio Devengado A deducir",
      "SUELDO BASE AT.JUN.24  1,08",
      "EXTRA −SUELDO BASE AT.JUN.24  0,13",
      "COMPLEMENTO DESTINO AT.JUN.24  0,54",
      "EXTRA −C. DESTINO AT.JUN.24  0,08",
      "C.P.TRANSITORIO AT.JUN.24  0,04",
      "EXTRA−C.P.TRANSITORI AT.JUN.24  0,01",
      "COMP.GEN.ESP.(EDUC.) AT.JUN.24  0,54",
      "COMP.SING.C.ESPECIFI AT.JUN.24  0,07",
      "EXTRA −C.GRAL.C.ESP. AT.JUN.24  0,09",
      "EXTRA −C.SING.C.ESPE AT.JUN.24  0,01",
      "VACACIONES MES ACTUA AT.JUN.24  38,95  0,19",
      "SEGURIDAD SOCIAL AT.JUN.24  2,79  0,13",
      "DESEMPLEO AT.JUN.24  2,79  0,04",
      "FORM. PROFESIONAL AT.JUN.24  2,79  0,01",
      "SUELDO BASE AT.JUN.25  5,62  4,12",
      "EXTRA −SUELDO BASE AT.JUN.25  836,78  101,09",
      "COMPLEMENTO DESTINO AT.JUN.25  2,80  2,05",
      "EXTRA −C. DESTINO AT.JUN.25  572,08  69,11",
      "C.P.TRANSITORIO AT.JUN.25  0,21  0,15",
      "EXTRA−C.P.TRANSITORI AT.JUN.25  41,94  5,07",
      "COMP.GEN.ESP.(EDUC.) AT.JUN.25  2,85  2,09",
      "EXTRA −C.GRAL.C.ESP. AT.JUN.25  581,91  70,30",
      "VACACIONES MES SIG. AT.JUN.25  2,00  78,49  156,98",
      "SEGURIDAD SOCIAL AT.JUN.25  156,22  7,83",
      "DESEMPLEO AT.JUN.25  156,22  2,58",
      "FORM. PROFESIONAL AT.JUN.25  156,22  0,17",
      "MEC EQUIDAD INTERGEN AT.JUN.25  156,22  0,21",
      "I.R.P.F. AT.JUN.25  400,59  17,91",
      "ATR. IRPF MISMO EJ. AT.JUN.25  4,47  10,37  0,46",
      "Remuneración Prorr. pagas extra Total Total Devengado Deducciones",
      "Líquido  384,40",
    ].join("\n");

    const parsed = matchConcepts(rawText);
    const vacaciones = parsed.concepts.find((concept) => concept.name === "Vacaciones (Atraso JUN.25)");
    const fakeVacationDeduction = parsed.concepts.find(
      (concept) => concept.name === "Vacaciones (Atraso JUN.25) (Deducción)",
    );

    expect(parsed.periodMonth).toBe(7);
    expect(parsed.periodYear).toBe(2025);
    expect(parsed.grossSalary).toBe(413.74);
    expect(parsed.netSalary).toBe(384.4);
    expect(vacaciones?.category).toBe("devengo");
    expect(vacaciones?.amount).toBe(156.98);
    expect(fakeVacationDeduction).toBeUndefined();
  });

  it("parses a real public-sector payslip end to end (extractor posicional)", () => {
    // Salida real del extractor posicional (pdfjs-dist) para una nómina de
    // organismo público — valida el pipeline completo, no solo el matcher.
    const rawText = [
      "Empleado  58431203W",
      "ARRONI DEL RIEGO, LAURA",
      "NOTIFICACION  DE RETRIBUCIONES",
      "Nómina",
      "NOMINA MENSUAL, ENERO  Datos bancarios:",
      "Período de liquidación  BANCO SANTANDER, S.A.",
      "Del  1/01/2026 al 31/01/2026  ES53 0049 1336 27 229031****",
      "P Concepto  Cantidad  T  Precio  Devengado  A deducir",
      "1 SUELDO BASE  25,81  %  567,26  146,39",
      "1 COMPLEMENTO DESTINO  25,81  %  282,84  72,99",
      "1 C.P.TRANSITORIO  25,81  %  20,74  5,35",
      "1 COMP.GEN.ESP.(EDUC.)  25,81  %  328,68  84,82",
      "1 COMP.SING.C.ESPECIFI  25,81  %  39,23  10,12",
      "1 PRESTACIONES IT  20,00  569,30",
      "1 COMP.PRESTACIONES IT  349,77",
      "SEGURIDAD SOCIAL  4,70  %  1.419,62  66,72",
      "DESEMPLEO  1,55  %  1.419,62  22,00",
      "FORM. PROFESIONAL  0,10  %  1.419,62  1,42",
      "MEC EQUIDAD INTERGEN  0,15  %  1.419,62  2,13",
      "I.R.P.F.  2,92  %  669,44  19,55",
      "I.R.P.F. EN IT  2,92  %  569,30  16,62",
      "Remuneración  Prorr. pagas extra  Total  Total  Devengado  Deducciones",
      "319,67  180,86  500,53  1.238,74  128,44",
      "Líquido  1.110,30",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(parsed.company).toBeNull();
    expect(parsed.periodMonth).toBe(1);
    expect(parsed.periodYear).toBe(2026);
    expect(parsed.grossSalary).toBe(1238.74);
    expect(parsed.netSalary).toBe(1110.3);
    expect(parsed.concepts).toHaveLength(13);
    expect(parsed.concepts.find((c) => c.name === "Salario Base")?.amount).toBe(146.39);
    expect(parsed.concepts.find((c) => c.name === "Prestaciones IT")?.amount).toBe(569.3);
    expect(parsed.concepts.find((c) => c.name === "Complemento Prestaciones IT")?.amount).toBe(349.77);
    expect(parsed.concepts.find((c) => c.name === "Contingencias Comunes")).toMatchObject({
      category: "deduccion",
      amount: 66.72,
    });
    expect(parsed.concepts.find((c) => c.name === "IRPF en IT")).toMatchObject({
      category: "deduccion",
      amount: 16.62,
    });
  });
});

describe("matchConcepts type1 (extractor posicional real)", () => {
  it("parsea una nómina real de empresa privada extraída con pdfjs-dist posicional", () => {
    const rawText = [
      "PAYA  GONZALEZ  ANTONIO",
      "NIF. B06875173  57",
      "EMPRESA  DOMICILIO  Nº INS. S.S.",
      "THENEXTPANGEA SL  RESIDENCIA LA GRANDA, S/N  33/1209671-67",
      "PAYA GONZALEZ ANTONIO  TITULADO 2  1 SEP 21  53781767Q",
      "33/10644607-75  2  100  4  MENS 01 ABR 26 a 30 ABR 26  30",
      "CUANTIA  PRECIO  CONCEPTO  DEVENGOS  DEDUCCIONES",
      "15,00  62,311  1  *Salario Base  934,67",
      "15,00  6,927  2  *Plus Convenio  103,90",
      "4  *Antigüedad  46,73",
      "36  *mejora absorbible  750,71",
      "140  *poliza seguro salud exento  41,66",
      "144  *poliza seguro vida No exento  5,12",
      "145  *poliza seg salud No Ex  35,92",
      "18,00  4,400  166  *catering exento  79,20",
      "715  abono trabajador seguros salud  19,40",
      "18,00  2,800  719  abono catering  50,40",
      "789  Dcto.Conceptos en Especie  161,90",
      "995  COTIZACION CONT.COMU 4,70  108,28",
      "994  COTIZACION MEI  0,15  3,46",
      "996  COTIZACION FORMACION 0,10  2,30",
      "997  COTIZACION DESEMPLEO 1,55  35,71",
      "999  TRIBUTACION I.R.P.F.21,49  394,56",
      "REM. TOTAL  P.P.EXTRAS  BASE S.S.  BASE A.T. Y DES.  BASE I.R.P.F.  T. DEVENGADO  T. A DEDUCIR",
      "1.997,91  306,00  4.440,66  4.440,66  1.877,05  2.006,73  784,83",
      "LIQUIDO A PERCIBIR",
      "1.221,90",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(parsed.company).toBe("THENEXTPANGEA SL");
    expect(parsed.periodMonth).toBe(4);
    expect(parsed.periodYear).toBe(2026);
    expect(parsed.grossSalary).toBe(2006.73);
    expect(parsed.netSalary).toBe(1221.9);
    expect(parsed.concepts.find((c) => c.name === "Salario Base")?.amount).toBe(934.67);
    expect(parsed.concepts.find((c) => c.name === "Abono Trabajador")).toMatchObject({
      category: "deduccion",
      amount: 19.4,
    });
    expect(parsed.concepts.find((c) => c.name === "Mejora Voluntaria")?.amount).toBe(750.71);
  });

  it("no infla un importe cuando el símbolo € está pegado sin espacio (regresión)", () => {
    // Texto limpio de pdfjs (sin OCR): el € pegado al importe no debe
    // colarse como si fuera un dígito más — "€934,67" no es "8934,67" ni
    // "934,67" con un € de más se lee como 934,678.
    const rawText = [
      "CONCEPTO  DEVENGOS  DEDUCCIONES",
      "1  *Salario Base  €934,67",
      "2  *Plus Convenio  103,90€",
      "LIQUIDO A PERCIBIR",
      "1.038,57",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(parsed.concepts.find((c) => c.name === "Salario Base")?.amount).toBe(934.67);
    expect(parsed.concepts.find((c) => c.name === "Plus Convenio")?.amount).toBe(103.9);
  });
});

describe("matchConcepts type1 APG OCR", () => {
  it("does not classify regular APG payrolls as extra and reconstructs gross from concepts", () => {
    const rawText = [
      "PAYA GONZALEZ ANTONIO",
      "33/10644607-75 | 2 1100| —_ | 4 [MENS 01 JUN 22 a 30 JUN 22",
      "CUANTA | PREcO | — cover — | pevencos | nenccoNES",
      "30,00 43,035 1| *Salario Base 1.291,04",
      "30,00 6,527 2 | *Plus Convenio 195,81",
      "36 | *mejora absorbible 1.041,72",
      "140 | *poliza seguro salud 28,98",
      "144 | *poliza seguro vida 3,23",
      "17,00 4,400 166 | *catering 74,80",
      "715 | abono trabajador seguros salud 7,25",
      "719 abono catering 42,50",
      "789| Dcto.Conceptos en Especie 107,01",
      "995 COTIZACION CONT.COMU 4,70 143,68",
      "996 COTIZACION FORMACION 0,10 3,06",
      "997 COTIZACION DESEMPLEO 1,55 47,38",
      "999 TRIBUTACION I.R.P.F.18,62 470,82",
      "REM. TOTAL P.P.EXTRAS |  BASESS. | BASEA.T.Y DES. | BASELRP.F. | T. DEVENGADO| T- A DEDUCIR",
      "30 JUNIO 2022",
      "LIQUIDO A PERCIBIR",
      "1.813,88",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(detectPayslipType(rawText)).toBe("ordinal");
    expect(parsed.periodMonth).toBe(6);
    expect(parsed.periodYear).toBe(2022);
    expect(parsed.grossSalary).toBe(2635.58);
    expect(parsed.netSalary).toBe(1813.88);
    expect(parsed.concepts.length).toBeGreaterThanOrEqual(9);
    expect(parsed.concepts.find((concept) => concept.name === "Salario Base")?.amount).toBe(1291.04);
    expect(parsed.concepts.find((concept) => concept.name === "Abono Trabajador")?.category).toBe("deduccion");
    expect(parsed.concepts.find((concept) => concept.name === "Descuento Conceptos en Especie")?.category).toBe("deduccion");
  });

  it("ignores liquid footer and employer contributions in APG OCR payrolls", () => {
    const rawText = [
      "PAYA GONZALEZ, ANTONIO",
      "33/10644607-75 | 3|401| | 72 [MENS 01 ENE 20 a 31 ENE 20",
      "CUAMA | PEGO | COMO | MEVECOS | NMUCOES",
      "30,00 41,498 1 | *Salario Base 1.244,93",
      "30,00 6,527 2 | *Plus convenio 195,81",
      "30,00 0,008 16 | *Prima Convenio 0,23",
      "35 | *PARTE PROP. PAGAS 207,48",
      "789 | Deto.Concentos en Especie 0,23",
      "995 COTIZACION CONT.COMU 4,70 77,48",
      "996 COTIZACION FORMACION 0,10 1,65",
      "997 COTIZACION DESEMPLEO 1,60 26,38",
      "999 TRIBUTACION I.R.P.F.11,60 191,22",
      "31 ENERO 2020",
      "LIQUIDO A PERCIBIR",
      "1.351,49",
      "IBAN: ES40 2048 0155 5430 0405 5064",
      "SWIFT/BIC: CECAESMM048  Y  COSTE EMPRESA: 2.188,30",
      "DETERMINA CION DE LAS B. DE COTIZACION A LA SS.",
      "CONCEPTO BASE TIPO APORTACION EMPRESARIAL",
      "1. Contingencias comunes 1.648,45 23,60 389,03",
      "AT y enfermedades 1.648,45 1,65 27,19",
      "DESEMPLEO 1.648,45 6,70 110,45",
      "Formacion Profesional 1.648,45 0,60 9,89",
      "Fondo Garantia Salarial 1.648,45 0,20 3,30",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(parsed.periodMonth).toBe(1);
    expect(parsed.periodYear).toBe(2020);
    expect(parsed.grossSalary).toBe(1648.45);
    expect(parsed.netSalary).toBe(1351.49);
    expect(parsed.concepts).toHaveLength(9);
    expect(parsed.concepts.some((concept) => concept.name === "COSTE EMPRESA")).toBe(false);
    expect(parsed.concepts.some((concept) => concept.amount === 389.03)).toBe(false);
    expect(parsed.concepts.find((concept) => concept.name === "IRPF")?.amount).toBe(191.22);
  });

  it("handles OCR-degraded liquid footer labels and malformed amount digits", () => {
    const rawText = [
      "PAYA GONZALEZ, ANTONIO",
      "33/10604607-75 | 3]a01| | 72 Jens 01 MAR 20 ai 31 MAR 20",
      "CuANTA | mEcO | ooNwd | peevos | pacos",
      "30,00 41,498 1| *Salario Base 1.244,93",
      "30,00 6,527 2| *Plus convenio 195,E1",
      "30,00 0,008 16| *Prima Convenio 0,23",
      "35 | *PARTE PROP.PAGAS 207,48",
      "789 Deto.Conceptos en Especie 0,23",
      "995 COTIZACION CONT.COMU 4,70 77,48",
      "996 COTIZACION FORMACION C,10 1,65",
      "997 COTIZACION DESEMPLEO 1,60 26,38",
      "999 TRIBUTACION I.R.P.F.11,60 191,22",
      "31 MARZO 2020",
      "LIQUDO A PERCBIR",
      "GaW 1.351,49",
      "IBAN: ES40 2048 0155 5430 0000 5064",
      "SWIFT/BIC: CECAESMM048 COSTE EMPRESA: 2.188,30",
      "DETERMINACION DE LAS B. DE COTIZACION A LA SS.",
      "CONCEPTO BASE TIO APORTACION EMPRESARIAL",
      "1. Contingencias comunes 1.648,45 23,60 389,03",
    ].join("\n");

    const parsed = matchConcepts(rawText);

    expect(parsed.periodMonth).toBe(3);
    expect(parsed.periodYear).toBe(2020);
    expect(parsed.grossSalary).toBe(1648.45);
    expect(parsed.netSalary).toBe(1351.49);
    expect(parsed.concepts.find((concept) => concept.name === "Plus Convenio")?.amount).toBe(195.81);
    expect(parsed.concepts.some((concept) => concept.name === "Concepto -1")).toBe(false);
  });

  it("keeps deduction codes stable when OCR damages percentage columns", () => {
    const rawText = [
      "PAYA GONZALEZ, ANTONIO",
      "33/10624607-75 | 3|401| | 72 [MENS 01 SEP 20 a 30 SEP 20",
      "30,00 41,498 1| *Salario Base 1.244,93",
      "30,00 6,527 2 | *Plus convenio 195,81",
      "30,00 0,008 16 | *Prima Convenio 0,23",
      "35 | *PARTE PROP.PAGAS 207,48",
      "789 | Dcto.Conceptos en Especie 0,23",
      "995 COTIZACION CONT.COMU 4,70 77,48",
      "996 COTIZACION FORMACION C,10 1,65",
      "997 COTIZACION DESEMPLEC 1,6C 26,38",
      "999 TRIBUTACION I.R.P.F.12,00 197,82",
      "30 SEPTIEMBRE 2020",
      "LIQUIDO A PERCBIR",
      "1.344,89",
    ].join("\n");

    const parsed = matchConcepts(rawText);
    const unemployment = parsed.concepts.find((concept) => concept.name === "Desempleo");

    expect(parsed.periodMonth).toBe(9);
    expect(parsed.periodYear).toBe(2020);
    expect(parsed.grossSalary).toBe(1648.45);
    expect(parsed.netSalary).toBe(1344.89);
    expect(unemployment?.category).toBe("deduccion");
    expect(unemployment?.amount).toBe(26.38);
    expect(parsed.concepts.some((concept) => concept.name === "Concepto -1")).toBe(false);
  });

  it("reconciles degraded april 2020 OCR against contribution bases", () => {
    const rawText = [
      "PAYA GONZALEZ, ANTONIO",
      "33/10644607-75 | 3|401| | 72 [MENS 01 ABR 20 a 30 ABR 20",
      "30,00 41,498 1| *+Salario Base 1.244,83",
      "30,00 6,527 2 ! *Plus convenio 195,81",
      "30,00 0,008 16 | *Frima Cenvenio 0,23",
      "35 | *FARTE PROF.PAGAS 207,48",
      "7€es Deto.Conceptes en Especie c,23",
      "995 COTIZACION CONT.COMU 4,70 77,46",
      "996 COTIZACION FORMACION 0,10 1,65",
      "997 COTIZACION DESEMPLEO 1,60 26,38",
      "999 TRIBUTACION I.R.P.F.12,00 197,82",
      "30 ABRIL 2020",
      "SWIFT/BIC: CECAESMM048 COSTE EMPRESA: 2.188,30",
      "DETERMINACION DE LAS B. DE COTIZACION A LA SS. Y CONCEPTOS DE RECAUDACION CONJUNTA Y APORTACION DE LA EMPRESA",
      "CONCEPTO BASE TIPO APORTACION EMPRESARIAL",
      "1. Contingencias comunes 1.648,45 23,60 389,03",
      "AT Y EP 1.648,45 1,65 27,19",
      "DESEMPLEO 1.648,45 6,70 110,45",
      "Formacion Profesional 1.648,45 0,60 9,89",
    ].join("\n");

    const parsed = matchConcepts(rawText);
    const salaryBase = parsed.concepts.find((concept) => concept.name === "Salario Base");
    const proportionalPays = parsed.concepts.find((concept) => concept.name === "Parte Proporcional Pagas");
    const discountInKind = parsed.concepts.find((concept) => concept.name === "Descuento Conceptos en Especie");
    const commonContingencies = parsed.concepts.find((concept) => concept.name === "Contingencias Comunes");

    expect(parsed.periodMonth).toBe(4);
    expect(parsed.periodYear).toBe(2020);
    expect(parsed.grossSalary).toBe(1648.45);
    expect(parsed.netSalary).toBe(1344.89);
    expect(salaryBase?.amount).toBe(1244.93);
    expect(proportionalPays?.amount).toBe(207.48);
    expect(discountInKind?.category).toBe("deduccion");
    expect(discountInKind?.amount).toBe(0.23);
    expect(commonContingencies?.amount).toBe(77.48);
  });

  it("recovers worker deductions that only appear after the footer on a second page", () => {
    const rawText = [
      "PAYA GONZALEZ ANTONIO",
      "THENEXTPANGEA SL",
      "MENS 01 SEP 25 a 30 SEP 25",
      "CONCEPTO DEVENGOS DEDUCCIONES",
      "1 *Salario Base 1.869,33",
      "2 *Plus Convenio 207,79",
      "3 *Antigüedad 93,47",
      "4 *Mejora Voluntaria 1.267,14",
      "140 *poliza seguro salud 36,60",
      "144 *poliza seguro vida 5,12",
      "166 *catering 26,40",
      "167 *retribucion flexible 88,00",
      "168 *retribucion flexible 28,62",
      "169 *Ajuste Nomina 1,24",
      "715 abono trabajador 9,15",
      "719 abono catering 16,80",
      "720 devolucion poliza 116,62",
      "789 Dcto.Conceptos en Especie 68,12",
      "790 Imp. Ingr. Cuenta 1,24",
      "995 COTIZACION CONT.COMU 4,70 198,10",
      "998 MEI 0,09 5,48",
      "996 COTIZACION FORMACION 0,10 4,21",
      "LIQUIDO A PERCIBIR",
      "2.296,68",
      "IBAN: ES11 1111 1111 1111 1111 1111",
      "SWIFT/BIC: TESTESMM111 COSTE EMPRESA: 4.618,45",
      "CONCEPTO BASE TIPO APORTACION EMPRESARIAL",
      "1. Contingencias comunes 4.214,98 23,60 994,74",
      "DESEMPLEO 4.214,98 5,50 231,82",
      "997 COTIZACION DESEMPLEO 1,55 65,33",
      "999 TRIBUTACION I.R.P.F.24,29 841,98",
    ].join("\n");

    const parsed = matchConcepts(rawText);
    const unemployment = parsed.concepts.find((concept) => concept.name === "Desempleo");
    const irpf = parsed.concepts.find((concept) => concept.name === "IRPF");

    expect(parsed.periodMonth).toBe(9);
    expect(parsed.periodYear).toBe(2025);
    expect(parsed.grossSalary).toBe(3623.71);
    expect(parsed.netSalary).toBe(2296.68);
    expect(unemployment?.category).toBe("deduccion");
    expect(unemployment?.amount).toBe(65.33);
    expect(irpf?.category).toBe("deduccion");
    expect(irpf?.amount).toBe(841.98);
    expect(parsed.concepts.some((concept) => concept.amount === 231.82)).toBe(false);
  });
});