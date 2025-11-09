package com.deva.tracing;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

final class TraceContext {

    private static final int MAX_EVENTS = 5;
    private static final DateTimeFormatter ISO_FORMAT = DateTimeFormatter.ISO_INSTANT;

    private final String serviceName;
    private final String traceId;
    private final long startMillis;
    private final String startIso;
    private final List<String> events = new ArrayList<>();

    TraceContext(String serviceName, String traceId) {
        this.serviceName = serviceName;
        this.traceId = traceId;
        this.startMillis = System.currentTimeMillis();
        this.startIso = ISO_FORMAT.format(Instant.ofEpochMilli(this.startMillis));
    }

    String getServiceName() {
        return serviceName;
    }

    String getTraceId() {
        return traceId;
    }

    long getStartMillis() {
        return startMillis;
    }

    void addEvent(String event) {
        if (event == null || event.isBlank()) {
            return;
        }
        if (events.size() >= MAX_EVENTS) {
            return;
        }
        events.add(event);
    }

    String buildTimeline(int statusCode, long durationMs) {
        StringBuilder sb = new StringBuilder();
        sb.append("[TRACE ");
        sb.append(shortId());
        sb.append(" -> ");
        sb.append(startIso);
        for (String event : events) {
            sb.append(" -> ");
            sb.append(event);
        }
        sb.append(" -> ");
        sb.append(serviceName);
        sb.append(": respond ");
        sb.append(statusCode);
        sb.append(" in ");
        sb.append(durationMs);
        sb.append("ms]");
        return sb.toString();
    }

    private String shortId() {
        return traceId.length() > 8 ? traceId.substring(0, 8) : traceId;
    }
}
