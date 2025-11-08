package com.deva.core_spring_service.util;

import java.util.Optional;

public final class CorrelationIdHolder {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private CorrelationIdHolder() {}

    public static void set(String correlationId) {
        CURRENT.set(correlationId);
    }

    public static Optional<String> get() {
        return Optional.ofNullable(CURRENT.get());
    }

    public static void clear() {
        CURRENT.remove();
    }
}
