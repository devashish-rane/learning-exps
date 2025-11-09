package com.deva.tracing;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.web.filter.OncePerRequestFilter;

class TraceSummaryFilter extends OncePerRequestFilter {

    private final String serviceName;

    TraceSummaryFilter(String serviceName) {
        this.serviceName = serviceName;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {
        TraceRecorder.start(serviceName, request, response);
        try {
            filterChain.doFilter(request, response);
        } finally {
            TraceRecorder.complete(request, response);
        }
    }
}
