import type { Account, CategoryGroup, PayeeSuggestion } from "../../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AccountSelect, CategorySelect, TypeToggle, amountInputClass, getTodayIsoDate, getYesterdayIsoDate, type TxType,
} from "./shared";
import { PayeeAutocomplete } from "./PayeeAutocomplete";

export interface TxForm {
  type: TxType;
  accountId: number | "";
  targetAccountId: number | "";
  categoryId: number | "";
  amount: string;
  date: string;
  payee: string;
  memo: string;
  cleared: boolean;
}

interface Props {
  open: boolean;
  editing: boolean;
  form: TxForm;
  setForm: (f: TxForm) => void;
  accounts: Account[];
  groups: CategoryGroup[];
  canCreateTransfers: boolean;
  pending: boolean;
  onClose: () => void;
  /** `addAnother`: guardar y dejar el formulario abierto para apuntar otro. */
  onSubmit: (addAnother: boolean) => void;
  onNewCategory: () => void;
}

const TYPES = ["expense", "income", "transfer"] as const;

function DateChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
        (active ? "bg-primary/10 text-primary-700 dark:text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

export function TransactionDialog({
  open, editing, form, setForm, accounts, groups, canCreateTransfers, pending, onClose, onSubmit, onNewCategory,
}: Props) {
  const isTransfer = form.type === "transfer";
  const title = editing ? "Editar transacción" : isTransfer ? "Movimiento entre cuentas" : "Nueva transacción";
  const description = editing
    ? "Actualiza importe, cuenta, categoría o notas."
    : isTransfer
      ? "Se registran ambos lados: cargo en la cuenta de origen y abono en la de destino."
      : "Registra un gasto o un ingreso. Cámbialo a transferencia si mueves saldo entre tus cuentas.";

  const today = getTodayIsoDate();
  const yesterday = getYesterdayIsoDate();

  // Al crear, la fecha manda sobre el estado: futura → prevista, hoy o antes → liquidada.
  const setDate = (date: string) =>
    setForm({ ...form, date, ...(editing || !date ? {} : { cleared: date <= today }) });

  // Elegir un beneficiario ya usado rellena lo que aún está vacío (nunca pisa
  // lo que el usuario ya ha elegido) con los datos de su último movimiento.
  const pickPayee = (s: PayeeSuggestion) =>
    setForm({
      ...form,
      payee: s.payee,
      ...(editing ? {} : {
        categoryId: form.categoryId || s.categoryId || "",
        amount: form.amount || s.amount.toFixed(2),
        accountId: form.accountId || s.accountId,
      }),
    });

  const accountField = (
    <div className="space-y-1.5">
      <div className="flex h-5 items-center"><Label htmlFor="tx-account">{isTransfer ? "Desde" : "Cuenta"}</Label></div>
      <AccountSelect id="tx-account" value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} accounts={accounts} />
    </div>
  );

  const payeeField = (
    <div className="space-y-1.5">
      <Label htmlFor="tx-payee">Beneficiario</Label>
      <PayeeAutocomplete
        id="tx-payee"
        value={form.payee}
        onChange={(payee) => setForm({ ...form, payee })}
        onPick={pickPayee}
        type={form.type === "transfer" ? null : form.type}
        placeholder={isTransfer ? "Opcional" : form.type === "income" ? "Ej: Empresa" : "Ej: Supermercado"}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(false); }}
          onKeyDown={(e) => {
            // Ctrl/⌘ + Enter: guardar y seguir con el siguiente.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !editing) {
              e.preventDefault();
              onSubmit(true);
            }
          }}
          className="flex max-h-[90vh] flex-col"
        >
          <DialogHeader className="border-b border-border px-5 pt-5 pb-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto px-5 py-5">
            <TypeToggle
              value={form.type}
              types={TYPES}
              disabled={canCreateTransfers || isTransfer ? [] : ["transfer"]}
              onChange={(t) => setForm({ ...form, type: t, targetAccountId: t === "transfer" ? form.targetAccountId : "", categoryId: t === "transfer" ? "" : form.categoryId })}
            />

            <div className="space-y-1.5">
              <Label htmlFor="tx-amount">Importe</Label>
              <div className="relative">
                <Input
                  id="tx-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  autoFocus
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0,00"
                  className={`h-11 text-lg font-semibold ${amountInputClass}`}
                  required
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-base text-muted-foreground">€</span>
              </div>
            </div>

            {/* Gasto/ingreso: importe → beneficiario → categoría (se autocompleta al elegir beneficiario). */}
            {!isTransfer && payeeField}

            <div className="grid gap-4 sm:grid-cols-2">
              {isTransfer ? (
                <>
                  {accountField}
                  <div className="space-y-1.5">
                    <div className="flex h-5 items-center"><Label htmlFor="tx-target">Hacia</Label></div>
                    <AccountSelect
                      id="tx-target"
                      value={form.targetAccountId}
                      onChange={(v) => setForm({ ...form, targetAccountId: v })}
                      accounts={accounts}
                      excludeId={form.accountId}
                      placeholder="Cuenta de destino"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="flex h-5 items-center justify-between gap-2">
                      <Label htmlFor="tx-category">Categoría</Label>
                      <button type="button" onClick={onNewCategory} className="cursor-pointer text-xs font-medium text-primary-700 hover:underline dark:text-primary">
                        Nueva
                      </button>
                    </div>
                    <CategorySelect id="tx-category" value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v })} groups={groups} />
                  </div>
                  {accountField}
                </>
              )}
              <div className="space-y-1.5">
                <div className="flex h-5 items-center justify-between gap-2">
                  <Label htmlFor="tx-date">Fecha</Label>
                  <span className="flex items-center gap-0.5">
                    <DateChip label="Hoy" active={form.date === today} onClick={() => setDate(today)} />
                    <DateChip label="Ayer" active={form.date === yesterday} onClick={() => setDate(yesterday)} />
                  </span>
                </div>
                <Input id="tx-date" type="date" value={form.date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              {isTransfer && payeeField}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-memo">Nota</Label>
              <Input id="tx-memo" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="Opcional" />
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="tx-cleared"
                checked={form.cleared}
                onCheckedChange={(checked) => setForm({ ...form, cleared: checked === true })}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label htmlFor="tx-cleared" className="cursor-pointer">Ya liquidada</Label>
                <p className="text-xs text-muted-foreground">
                  {form.cleared
                    ? "Cuenta ya en tu saldo, el presupuesto y las gráficas."
                    : "Prevista: no afecta al saldo ni a las gráficas hasta que la liquides."}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            {!editing && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onSubmit(true)}
                title="Ctrl/⌘ + Enter"
              >
                Guardar y añadir otra
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : editing ? "Guardar cambios" : isTransfer ? "Crear movimiento" : "Crear transacción"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
