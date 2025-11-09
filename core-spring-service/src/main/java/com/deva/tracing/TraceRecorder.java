package com.deva.tracing;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.servlet.HandlerMapping;

final class TraceRecorder {

    private static final Logger LOGGER = LoggerFactory.getLogger("TRACE_SUMMARY");
    private static final ThreadLocal<TraceContext> CURRENT = new ThreadLocal<>();
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Pattern TRACEPARENT = Pattern.compile("^[\n\r\t ]*00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}.*$");

    private TraceRecorder() {
    }

    static void start(String serviceName, HttpServletRequest request, HttpServletResponse response) {
        String traceId = extractOrCreateTraceId(request);
        TraceContext context = new TraceContext(serviceName, traceId);
        CURRENT.set(context);
        response.setHeader("traceparent", buildTraceparent(traceId));
        response.setHeader("X-Request-Id", traceId);
    }

    static void recordEvent(String event) {
        TraceContext context = CURRENT.get();
        if (context != null) {
            context.addEvent(event);
        }
    }

    static void recordMethod(String signature) {
        recordEvent(contextPrefix() + signature);
    }

    static void recordHttp(String description) {
        recordEvent(contextPrefix() + description);
    }

    private static String contextPrefix() {
        TraceContext context = CURRENT.get();
        return context == null ? "" : context.getServiceName() + ": ";
    }

    static String currentTraceId() {
        TraceContext context = CURRENT.get();
        return context == null ? null : context.getTraceId();
    }

    static String currentTraceparent() {
        String traceId = currentTraceId();
        if (traceId == null) {
            return null;
        }
        return buildTraceparent(traceId);
    }

    static void complete(HttpServletRequest request, HttpServletResponse response) {
        TraceContext context = CURRENT.get();
        if (context == null) {
            return;
        }
        try {
            String requestName = deriveRequestName(request);
            long duration = System.currentTimeMillis() - context.getStartMillis();
            String timeline = context.buildTimeline(response.getStatus(), duration);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("ts", java.time.Instant.now().toString());
            payload.put("service", context.getServiceName());
            payload.put("level", "INFO");
            payload.put("event", "TRACE_SUMMARY");
            payload.put("traceId", context.getTraceId());
            payload.put("requestName", requestName);
            payload.put("timeline", timeline);
            LOGGER.info(writeJson(payload));
        } finally {
            CURRENT.remove();
        }
    }

    private static String writeJson(Map<String, Object> payload) {
        try {
            return MAPPER.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            return payload.toString();
        }
    }

    private static String deriveRequestName(HttpServletRequest request) {
        Object attribute = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String pattern = attribute instanceof String ? (String) attribute : request.getRequestURI();
        String method = request.getMethod();
        List<String> tokens = new ArrayList<>();
        for (String segment : pattern.replaceFirst("^/", "").split("/")) {
            if (segment.isBlank()) {
                continue;
            }
            String clean = segment.replace("{", "").replace("}", "");
            tokens.add(capitalize(clean));
        }
        if (tokens.isEmpty()) {
            tokens.add("Request");
        }
        StringBuilder builder = new StringBuilder(tokens.get(0));
        builder.append('_');
        builder.append(capitalize(method.toLowerCase(Locale.ENGLISH)));
        tokens.stream().skip(1).forEach(builder::append);
        return builder.toString();
    }

    private static String capitalize(String value) {
        if (value == null || value.isBlank()) {
            return "Request";
        }
        String lower = value.toLowerCase(Locale.ENGLISH);
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    private static String extractOrCreateTraceId(HttpServletRequest request) {
        String traceparent = request.getHeader("traceparent");
        if (traceparent != null) {
            var matcher = TRACEPARENT.matcher(traceparent);
            if (matcher.matches()) {
                return matcher.group(1);
            }
        }
        String legacy = request.getHeader("X-Request-Id");
        if (legacy != null && legacy.length() >= 16) {
            return toTraceId(legacy);
        }
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static String toTraceId(String value) {
        String hex = value.replaceAll("[^0-9a-fA-F]", "");
        if (hex.length() >= 32) {
            return hex.substring(0, 32).toLowerCase(Locale.ENGLISH);
        }
        return (hex + UUID.randomUUID().toString().replace("-", "")).substring(0, 32).toLowerCase(Locale.ENGLISH);
    }

    private static String buildTraceparent(String traceId) {
        String spanId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        return "00-" + traceId + "-" + spanId + "-01";
    }

}
