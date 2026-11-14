package com.webox;

import com.webox.common.RequestContext;
import com.webox.common.Util;
import com.webox.dto.Dtos;
import com.webox.order.OrderStateMachine;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class UtilTest {
    private ZonedDateTime at(String date, int h, int m, int s) {
        return ZonedDateTime.of(LocalDate.parse(date), LocalTime.of(h, m, s), RequestContext.ZONE);
    }

    @Test
    void moneyIsIntegerCentsAndNeverFloatingPoint() {
        assertEquals("¥0.00", Util.money(0));
        assertEquals("¥22.50", Util.money(2250));
        assertEquals("¥38.00", Util.money(3800));
        assertEquals("¥1234.05", Util.money(123405));
        long unit = 3580 + 300 + 200; // base + cheese + fried egg
        assertEquals(8160L, unit * 2);
        assertEquals("¥81.60", Util.money(unit * 2));
    }

    /** AC-024/025: six cutoff boundaries + cross-day. */
    @Test
    void cutoffSixBoundariesAndCrossDay() {
        String d = "2026-11-14";
        // 09:59:59 -> today Lunch, no switch
        var r1 = Util.resolveMeal(LocalDate.parse(d), "Lunch", at(d, 9, 59, 59));
        assertEquals(LocalDate.parse(d), r1.date());
        assertEquals("Lunch", r1.meal());
        assertFalse(r1.autoSwitched());

        // 10:00:00 == cutoff -> closed, auto switch to today Dinner
        var r2 = Util.resolveMeal(LocalDate.parse(d), "Lunch", at(d, 10, 0, 0));
        assertEquals("Dinner", r2.meal());
        assertEquals(LocalDate.parse(d), r2.date());
        assertTrue(r2.autoSwitched());

        // 10:00:01 -> today Dinner
        var r3 = Util.resolveMeal(LocalDate.parse(d), "Lunch", at(d, 10, 0, 1));
        assertEquals("Dinner", r3.meal());
        assertTrue(r3.autoSwitched());

        // 14:59:59 -> today Dinner allowed
        var r4 = Util.resolveMeal(LocalDate.parse(d), "Dinner", at(d, 14, 59, 59));
        assertEquals("Dinner", r4.meal());
        assertFalse(r4.autoSwitched());

        // 15:00:00 == cutoff -> tomorrow Lunch
        var r5 = Util.resolveMeal(LocalDate.parse(d), "Dinner", at(d, 15, 0, 0));
        assertEquals(LocalDate.parse(d).plusDays(1), r5.date());
        assertEquals("Lunch", r5.meal());
        assertTrue(r5.autoSwitched());

        // 15:00:01 -> tomorrow Lunch
        var r6 = Util.resolveMeal(LocalDate.parse(d), "Dinner", at(d, 15, 0, 1));
        assertEquals(LocalDate.parse(d).plusDays(1), r6.date());
        assertTrue(r6.autoSwitched());

        // cross-day: tomorrow Lunch requested today 16:00 -> allowed
        var r7 = Util.resolveMeal(LocalDate.parse(d).plusDays(1), "Lunch", at(d, 16, 0, 0));
        assertEquals(LocalDate.parse(d).plusDays(1), r7.date());
        assertEquals("Lunch", r7.meal());
        assertFalse(r7.autoSwitched());

        // past date rejected
        var ex = assertThrows(com.webox.common.ApiException.class,
                () -> Util.resolveMeal(LocalDate.parse(d).minusDays(1), "Lunch", at(d, 9, 0, 0)));
        assertEquals("VALIDATION_DATE_PAST", ex.getCode());
    }

    @Test
    void canonicalHashIgnoresFieldAndOptionOrderButDetectsBodyChange() {
        var a = new Dtos.SubmitReq(List.of(
                new Dtos.ItemReq(9L, 1, List.of(15L, 17L)),
                new Dtos.ItemReq(2L, 1, List.of(1L))), "2026-11-15", "Lunch", "Building A", true);
        var b = new Dtos.SubmitReq(List.of(
                new Dtos.ItemReq(2L, 1, List.of(1L)),
                new Dtos.ItemReq(9L, 1, List.of(17L, 15L))), "2026-11-15", "Lunch", "Building A", true);
        assertEquals(Util.canonicalSubmit(a), Util.canonicalSubmit(b));

        var c = new Dtos.SubmitReq(List.of(new Dtos.ItemReq(9L, 2, List.of(15L, 17L))),
                "2026-11-15", "Lunch", "Building A", true);
        assertNotEquals(Util.canonicalSubmit(a), Util.canonicalSubmit(c));
    }

    @Test
    void stateMachineOnlyAllowsThreeTransitions() {
        assertTrue(OrderStateMachine.canTransition("Pending", "Confirmed"));
        assertTrue(OrderStateMachine.canTransition("Confirmed", "Completed"));
        assertTrue(OrderStateMachine.canTransition("Pending", "Cancelled"));
        assertFalse(OrderStateMachine.canTransition("Confirmed", "Cancelled"));
        assertFalse(OrderStateMachine.canTransition("Completed", "Cancelled"));
        assertFalse(OrderStateMachine.canTransition("Completed", "Completed"));
        assertFalse(OrderStateMachine.canTransition("Pending", "Pending"));
        assertTrue(OrderStateMachine.canEmployeeCancel("Pending"));
        assertFalse(OrderStateMachine.canEmployeeCancel("Confirmed"));
    }

    @Test
    void likeEscapingNeutralizesWildcards() {
        assertEquals("100\\%\\_safe", Util.escapeLike("100%_safe"));
    }

    /** Regression for P1 AC-004: JDBC DATETIME may arrive as LocalDateTime / Timestamp / String. */
    @Test
    void localDateTimeAcceptsAllJdbcShapes() {
        var expected = LocalDateTime.of(2026, 11, 14, 22, 30, 15);
        assertEquals(expected, Util.localDateTime(expected));
        assertEquals(expected,
                Util.localDateTime(java.sql.Timestamp.valueOf(expected)));
        assertEquals(expected,
                Util.localDateTime("2026-11-14 22:30:15"));
        assertEquals(expected,
                Util.localDateTime("2026-11-14T22:30:15"));
        assertEquals(LocalDateTime.of(2026, 11, 14, 0, 0),
                Util.localDateTime("2026-11-14"));
        assertNull(Util.localDateTime(null));
        assertNull(Util.localDateTime("not-a-timestamp"));
    }
}