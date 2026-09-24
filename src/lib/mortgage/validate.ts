import type { ScheduleInput } from './types.ts';

export class ScheduleInputError extends RangeError {
  /** Поле формы, к которому относится ошибка */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ScheduleInputError';
    this.field = field;
  }
}

const isInt = (value: unknown): value is number => Number.isInteger(value);

/** Полное число месяцев графика с учётом продления отсрочками */
export function plannedMonths(input: ScheduleInput): number {
  const grace = (input.gracePeriods ?? []).reduce((sum, g) => sum + g.months, 0);
  return input.graceExtendsTerm ? input.months + grace : input.months;
}

/**
 * Проверяет вход и бросает ScheduleInputError с понятным сообщением и полем.
 * Возвращает нормализованный вход (сумма как число, необязательные поля заполнены).
 */
export function validateInput(
  input: ScheduleInput,
): Required<Omit<ScheduleInput, 'amount'>> & { amount: number } {
  const amount =
    typeof input.amount === 'string' ? Number(input.amount.replace(',', '.')) : input.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ScheduleInputError('amount', 'Сумма кредита должна быть больше 0');
  }
  if (!isInt(input.months) || input.months < 1) {
    throw new ScheduleInputError('months', 'Срок должен быть целым числом месяцев от 1');
  }
  if (input.months > 600) {
    throw new ScheduleInputError('months', 'Срок не больше 600 месяцев (50 лет)');
  }
  if (input.type !== 'annuity' && input.type !== 'diff') {
    throw new ScheduleInputError('type', `Неизвестный тип графика: ${String(input.type)}`);
  }

  const rates = [...input.rates].sort((a, b) => a.fromMonth - b.fromMonth);
  if (rates.length === 0) throw new ScheduleInputError('rates', 'Нужна хотя бы одна ставка');
  if (rates[0]!.fromMonth !== 1) {
    throw new ScheduleInputError('rates', 'Первая ставка должна действовать с 1-го месяца');
  }
  rates.forEach((r, i) => {
    if (!Number.isFinite(r.ratePercent) || r.ratePercent < 0) {
      throw new ScheduleInputError(`rates.${i}`, 'Ставка не может быть отрицательной');
    }
    if (!isInt(r.fromMonth) || r.fromMonth < 1) {
      throw new ScheduleInputError(
        `rates.${i}`,
        'Месяц начала ставки должен быть целым числом от 1',
      );
    }
    if (i > 0 && r.fromMonth === rates[i - 1]!.fromMonth) {
      throw new ScheduleInputError(`rates.${i}`, `Две ставки начинаются с месяца ${r.fromMonth}`);
    }
  });

  const gracePeriods = [...(input.gracePeriods ?? [])].sort((a, b) => a.start - b.start);
  const total = plannedMonths({ ...input, gracePeriods });
  gracePeriods.forEach((g, i) => {
    if (!isInt(g.start) || g.start < 1) {
      throw new ScheduleInputError(
        `grace.${i}`,
        'Месяц начала отсрочки должен быть целым числом от 1',
      );
    }
    if (!isInt(g.months) || g.months < 1) {
      throw new ScheduleInputError(
        `grace.${i}`,
        'Длительность отсрочки — целое число месяцев от 1',
      );
    }
    const end = g.start + g.months - 1;
    if (end >= total) {
      throw new ScheduleInputError(
        `grace.${i}`,
        `Отсрочка должна закончиться не позже месяца ${total - 1}: после неё нужен хотя бы один платёж по долгу`,
      );
    }
    const prev = gracePeriods[i - 1];
    if (prev && g.start <= prev.start + prev.months - 1) {
      throw new ScheduleInputError(`grace.${i}`, 'Периоды отсрочки пересекаются');
    }
  });

  const prepayments = [...(input.prepayments ?? [])].sort((a, b) => a.month - b.month);
  prepayments.forEach((p, i) => {
    if (!isInt(p.month) || p.month < 1) {
      throw new ScheduleInputError(
        `prepayments.${i}`,
        'Месяц досрочного погашения — целое число от 1',
      );
    }
    if (!Number.isFinite(p.amount) || p.amount <= 0) {
      throw new ScheduleInputError(
        `prepayments.${i}`,
        'Сумма досрочного погашения должна быть больше 0',
      );
    }
    if (p.kind !== undefined && p.kind !== 'extra' && p.kind !== 'budget') {
      throw new ScheduleInputError(
        `prepayments.${i}`,
        `Неизвестный вид досрочного погашения: ${String(p.kind)}`,
      );
    }
    if (p.untilMonth !== undefined && (!isInt(p.untilMonth) || p.untilMonth < p.month)) {
      throw new ScheduleInputError(
        `prepayments.${i}`,
        'Месяц окончания повторов не раньше месяца начала',
      );
    }
  });

  return {
    amount,
    months: input.months,
    type: input.type,
    rates,
    gracePeriods,
    graceExtendsTerm: Boolean(input.graceExtendsTerm),
    interestInArrears: Boolean(input.interestInArrears),
    prepayments,
  };
}
