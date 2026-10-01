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

// Bug fix, 2026-09-30 (human report) — compared effectiveMonth against the
// raw UTC year-month, so the last few hours of every Bogotá calendar day
// (from 7pm Bogotá to midnight UTC) were already read as the NEXT month on
// the server, wrongly flagging the just-entered current month's rate as
// stale. Same fixed UTC-5 shift used throughout this codebase for this
// exact class of bug — see installmentCalculations.ts's
// BOGOTA_UTC_OFFSET_MS and businessHours.ts's identical constant; Colombia
// has no DST, so a plain arithmetic shift is enough. `today` is injectable
// for tests, same convention as calculatePayoff/calculateOverdueDays.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

function currentYearMonth(today: Date = new Date()): string {
  return new Date(today.getTime() - BOGOTA_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

@Injectable()
export class UsuryRateService {
  constructor(
    @InjectRepository(UsuryRate)
    private readonly repository: Repository<UsuryRate>,
  ) {}

  // Bug fix, 2026-09-30 (human report, production) — used to take the
  // single most recent row ever inserted, with no upper bound. Entering a
  // future month's rate ahead of time (the Superintendencia sometimes
  // publishes early, and nothing stops an admin from registering it the
  // moment it's out) made THAT future row "vigente" immediately, before
  // its own month had even started — "Tasa vigente (Octubre de 2026)"
  // showing while today is still September — and simultaneously flagged
  // `isStale: true` against it (October ≠ September), surfacing "la tasa
  // de septiembre todavía no se ha ingresado" even though September's own
  // rate was sitting right there in the history table, just shadowed by
  // the newer row. Fixed by bounding the query to rows on or before the
  // current month — same `LessThanOrEqual` pattern getRateForMonth already
  // uses for historical lookups — so a future-dated row sits in history
  // inert until its own month actually arrives, instead of jumping the
  // queue. `today` injectable for tests (defaults to the real clock), same
  // convention as calculatePayoff/calculateOverdueDays elsewhere in this
  // codebase.
  async getCurrentRate(
    today: Date = new Date(),
  ): Promise<CurrentUsuryRate | null> {
    const currentMonth = currentYearMonth(today);
    const latest = await this.repository.findOne({
      where: { effectiveMonth: LessThanOrEqual(`${currentMonth}-01`) },
      order: { effectiveMonth: 'DESC' },
    });
    if (!latest) return null;

    return {
      ...latest,
      isStale: latest.effectiveMonth.slice(0, 7) !== currentMonth,
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
