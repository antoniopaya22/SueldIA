import { describe, expect, it } from "vitest";
import { classifyConcept } from "./concept-classifier.js";

describe("classifyConcept", () => {
  it.each([
    ["IRPF", "irpf"],
    ["Retención I.R.P.F.", "irpf"],
    ["I.R.P.F. 15,00%", "irpf"],
    ["Retención a cuenta", "irpf"],
    ["Cotización contingencias comunes", "ss_contingencias"],
    ["CONT.COMUNES 4,70%", "ss_contingencias"],
    ["Desempleo", "ss_desempleo"],
    ["Formación profesional", "ss_formacion"],
    ["MEI", "ss_mei"],
    ["Mecanismo de Equidad Intergeneracional", "ss_mei"],
    ["Cotización horas extra", "ss_otros"],
    ["Anticipo", "otros"],
  ])("deducción «%s» → %s", (name, kind) => {
    expect(classifyConcept(name, "deduccion")).toBe(kind);
  });

  it.each([
    ["Salario base", "salario_base"],
    ["SUELDO BASE", "salario_base"],
    ["Plus convenio", "complemento"],
    ["Complemento de destino", "complemento"],
    ["Antigüedad", "complemento"],
    ["Paga extra junio", "paga_extra"],
    ["Prorrata pagas extras", "paga_extra"],
    ["Horas extraordinarias", "horas_extra"],
    ["Seguro médico (retribución en especie)", "especie"],
    ["Dietas", "dieta"],
    ["Atrasos", "otros"],
  ])("devengo «%s» → %s", (name, kind) => {
    expect(classifyConcept(name, "devengo")).toBe(kind);
  });

  it("categoría otros siempre es otros", () => {
    expect(classifyConcept("IRPF", "otros")).toBe("otros");
  });
});
