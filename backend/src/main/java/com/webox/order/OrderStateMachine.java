package com.webox.order;

/** Pure order state machine, shared by admin status transitions and tests. */
public final class OrderStateMachine {
    private OrderStateMachine() {}

    public static boolean canTransition(String from, String to) {
        if (from == null || to == null) return false;
        return ("Pending".equals(from) && "Confirmed".equals(to))
                || ("Confirmed".equals(from) && "Completed".equals(to))
                || ("Pending".equals(from) && "Cancelled".equals(to));
    }

    public static boolean canEmployeeCancel(String status) {
        return "Pending".equals(status);
    }
}