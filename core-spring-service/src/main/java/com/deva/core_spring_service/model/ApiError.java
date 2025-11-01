package com.deva.core_spring_service.model;


import org.springframework.validation.FieldError;

import java.time.Instant;
import java.util.List;

public record ApiError(
        Instant timestamp,
        String traceId,
        int status,
        String error,
        String message,
        List<FieldErr> details,
        String path
) {}

