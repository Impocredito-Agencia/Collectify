import { MessageType } from './messageType.enum';

export interface MessageTypeParameter {
  // What the value is, for the panel's template editor.
  label: string;
  // A realistic value, in the exact format the selection code produces —
  // used for the editor's preview and for template test sends.
  example: string;
}

const TRATAMIENTO: MessageTypeParameter = {
  label: 'Tratamiento y nombre del cliente',
  example: 'Señor/a Juana Pérez',
};
const PAGARE: MessageTypeParameter = {
  label: 'Número del pagaré',
  example: '#1021',
};
const REMINDER_NOTA: MessageTypeParameter = {
  label:
    'Nota final: "Gracias por su atención.", saldo pendiente o saldo a favor',
  example: 'Gracias por su atención.',
};
const CONFIRMATION_NOTA: MessageTypeParameter = {
  label: 'Nota final: "Gracias por su atención." o saldo a favor',
  example: 'Cuenta con un saldo a favor de $20.000.',
};

const NEW_LOAN_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  PAGARE,
  { label: 'Fecha de vigencia', example: '9 de noviembre de 2026' },
  {
    label: 'Detalle del producto (puede tener varias líneas)',
    example: 'Celular Samsung A15',
  },
  { label: 'Número de cuotas', example: '10' },
  { label: 'Periodicidad (mensuales / quincenales)', example: 'mensuales' },
  { label: 'Valor de cada cuota', example: '$150.000' },
  { label: 'Fecha de la primera cuota', example: '9 de diciembre de 2026' },
];

const NEW_LOAN_WITH_DOWN_PAYMENT_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  PAGARE,
  { label: 'Fecha de vigencia', example: '9 de noviembre de 2026' },
  {
    label: 'Detalle del producto (puede tener varias líneas)',
    example: 'Celular Samsung A15',
  },
  { label: 'Número total de cuotas (con la inicial)', example: '10' },
  { label: 'Periodicidad (mensuales / quincenales)', example: 'mensuales' },
  { label: 'Valor de la cuota inicial', example: '$300.000' },
  { label: 'Número de cuotas restantes', example: '9' },
  { label: 'Valor de cada cuota restante', example: '$150.000' },
  { label: 'Fecha de la primera cuota', example: '9 de diciembre de 2026' },
];

const SINGLE_OVERDUE_WITH_SURCHARGE_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  { label: 'Número de la cuota', example: '3' },
  PAGARE,
  { label: 'Hace cuánto venció', example: 'hace 12 días' },
  { label: 'Valor a pagar hoy (con recargos)', example: '$165.000' },
  REMINDER_NOTA,
];

const MULTIPLE_OVERDUE_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  { label: 'Número de cuotas vencidas', example: '2' },
  { label: 'Hace cuánto venció la más antigua', example: 'hace 20 días' },
  { label: 'Valor a pagar hoy (con recargos)', example: '$330.000' },
  REMINDER_NOTA,
];

const MIXED_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  { label: 'Número de cuotas vencidas', example: '2' },
  { label: 'Valor de las vencidas (con recargos)', example: '$330.000' },
  { label: 'Número de cuotas próximas a vencer', example: '1' },
  { label: 'Valor de las próximas a vencer', example: '$150.000' },
  REMINDER_NOTA,
];

const CREDIT_REPORT_PARAMETERS: MessageTypeParameter[] = [
  TRATAMIENTO,
  PAGARE,
  { label: 'Valor en mora (con recargos)', example: '$330.000' },
];

// Phase 36 — the {{1}}, {{2}}, ... values each message type is sent with,
// in order. This is the same `bodyParameters` array the template selection
// code (reminderTemplateSelection.ts, newLoanTemplateSelection.ts,
// paymentConfirmationTemplateSelection.ts, creditReportTemplateSelection.ts)
// already builds for WhatsApp; the email and SMS templates are filled with
// it too, so every channel shows exactly the same figures. Keep this in
// sync with those files — messageTypeParameters.spec.ts checks the counts.
export const MESSAGE_TYPE_PARAMETERS: Record<
  MessageType,
  MessageTypeParameter[]
> = {
  [MessageType.NewLoanNewClient]: NEW_LOAN_PARAMETERS,
  [MessageType.NewLoanNewClientInitialInstallment]:
    NEW_LOAN_WITH_DOWN_PAYMENT_PARAMETERS,
  [MessageType.NewLoanExistingClient]: NEW_LOAN_PARAMETERS,
  [MessageType.NewLoanExistingClientInitialInstallment]:
    NEW_LOAN_WITH_DOWN_PAYMENT_PARAMETERS,
  [MessageType.RefinanceSingleLoan]: [
    TRATAMIENTO,
    { label: 'Número del pagaré refinanciado', example: '#1021' },
    { label: 'Número de cuotas nuevas', example: '12' },
    { label: 'Periodicidad (mensuales / quincenales)', example: 'mensuales' },
    { label: 'Valor de cada cuota nueva', example: '$120.000' },
    { label: 'Fecha de la primera cuota', example: '9 de diciembre de 2026' },
  ],
  [MessageType.SingleUpcomingInstallment]: [
    TRATAMIENTO,
    { label: 'Número de la cuota', example: '3' },
    PAGARE,
    { label: 'Valor de la cuota', example: '$150.000' },
    {
      label: 'Cuándo vence (hoy / mañana / en N días)',
      example: 'en 3 días',
    },
    REMINDER_NOTA,
  ],
  [MessageType.MultipleUpcomingInstallments]: [
    TRATAMIENTO,
    { label: 'Número de cuotas próximas a vencer', example: '2' },
    { label: 'Valor total de esas cuotas', example: '$300.000' },
    {
      label: 'Cuándo vence la más próxima (hoy / mañana / en N días)',
      example: 'en 3 días',
    },
    REMINDER_NOTA,
  ],
  [MessageType.SingleOverdueInstallment]: [
    TRATAMIENTO,
    { label: 'Número de la cuota', example: '3' },
    PAGARE,
    { label: 'Valor de la cuota', example: '$150.000' },
    { label: 'Hace cuánto venció', example: 'hace 5 días' },
    REMINDER_NOTA,
  ],
  [MessageType.SingleOverdueInstallmentWithSurcharge]:
    SINGLE_OVERDUE_WITH_SURCHARGE_PARAMETERS,
  [MessageType.SingleOverdueInstallmentWithSurchargeOver30Days]:
    SINGLE_OVERDUE_WITH_SURCHARGE_PARAMETERS,
  [MessageType.MultipleOverdueInstallments]: MULTIPLE_OVERDUE_PARAMETERS,
  [MessageType.MultipleOverdueInstallmentsOver30Days]:
    MULTIPLE_OVERDUE_PARAMETERS,
  [MessageType.UpcomingAndOverdueMixed]: MIXED_PARAMETERS,
  [MessageType.UpcomingAndOverdueMixedOver30Days]: MIXED_PARAMETERS,
  [MessageType.CreditReport30Days]: CREDIT_REPORT_PARAMETERS,
  [MessageType.CreditReport50Days]: CREDIT_REPORT_PARAMETERS,
  [MessageType.PaymentConfirmation]: [
    TRATAMIENTO,
    { label: 'Número de la cuota pagada', example: '3' },
    PAGARE,
    { label: 'Cuotas pendientes en ese pagaré', example: '7' },
    CONFIRMATION_NOTA,
  ],
  [MessageType.PaidInFull]: [TRATAMIENTO, PAGARE, CONFIRMATION_NOTA],
};

export function exampleParametersFor(type: MessageType): string[] {
  return MESSAGE_TYPE_PARAMETERS[type].map((parameter) => parameter.example);
}
