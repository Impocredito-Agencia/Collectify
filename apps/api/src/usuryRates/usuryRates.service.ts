import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { convertAnnualToMonthlyRate } from './convertAnnualToMonthlyRate';
import { CreateUsuryRateDto } from './dto/createUsuryRate.dto';
import { UsuryRate } from './entities/usuryRate.entity';

export interface CurrentUsuryRate extends UsuryRate {
  // True when nobody has entered this calendar month's certified rate yet
  // (whether it's the 1st or the 20th) — computed on read by comparing the
  // latest row's effectiveMonth to today's year-month, never stored. See
  // docs/phases/PHASE_15_USURY_RATE.md "Stale-rate alert".
  isStale: boolean;
}

// Dates are plain 'YYYY-MM-DD' strings throughout this codebase (see
// disbursedAt, dueDate) — string comparison on ISO-formatted dates sorts
// correctly, so month math here stays string-based rather than parsing
// into Date objects, avoiding the timezone pitfalls documented in
// installmentCalculations.ts.
function toMonthStart(dateString: string): string {
  return `${dateString.slice(0, 7)}-01`;
}

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

@Injectable()
export class UsuryRateService {
  constructor(
    @InjectRepository(UsuryRate)
    private readonly repository: Repository<UsuryRate>,
  ) {}

  async getCurrentRate(): Promise<CurrentUsuryRate | null> {
    // findOne() requires a `where` clause in this TypeORM version — find()
    // with take: 1 is the correct way to fetch "the single most recent row"
    // with no filter.
    const [latest] = await this.repository.find({
      order: { effectiveMonth: 'DESC' },
      take: 1,
    });
    if (!latest) return null;

    return {
      ...latest,
      isStale: latest.effectiveMonth.slice(0, 7) !== currentYearMonth(),
    };
  }

  // The rate that was in effect during a given month — the most recent row
  // whose effectiveMonth is on or before that month. Used for historical
  // lookups; a change in the current month's rate never alters what this
  // returns for a past month (confirmed non-retroactive, see
  // docs/phases/PHASE_15_USURY_RATE.md "Resolved").
  getRateForMonth(date: string): Promise<UsuryRate | null> {
    return this.repository.findOne({
      where: { effectiveMonth: LessThanOrEqual(toMonthStart(date)) },
      order: { effectiveMonth: 'DESC' },
    });
  }

  findAll(): Promise<UsuryRate[]> {
    return this.repository.find({ order: { effectiveMonth: 'DESC' } });
  }

  // Always inserts a new row — never mutates a previous month's rate, so
  // history stays intact (confirmed with the human). A duplicate month is
  // rejected rather than silently overwritten.
  async setRate(
    dto: CreateUsuryRateDto,
    actorUserId: string | null,
  ): Promise<UsuryRate> {
    const effectiveMonth = toMonthStart(dto.effectiveMonth);

    const existing = await this.repository.findOneBy({ effectiveMonth });
    if (existing) {
      throw new ConflictException(
        `A usury rate for ${effectiveMonth} already exists — historical rows are never overwritten. Enter a different month.`,
      );
    }

    const rate = this.repository.create({
      effectiveMonth,
      annualRatePercentage: dto.annualRatePercentage,
      ratePercentage: convertAnnualToMonthlyRate(dto.annualRatePercentage),
      createdBy: actorUserId,
    });
    return this.repository.save(rate);
  }
}
