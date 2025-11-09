package com.deva.core_spring_service.exception;

import com.deva.core_spring_service.model.ApiError;
import com.deva.core_spring_service.model.FieldErr;
import com.deva.core_spring_service.exception.ProducerUnavailableException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.List;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest req) {
        List<FieldErr> details = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> new FieldErr(fe.getField(), fe.getDefaultMessage())).toList();
        return build(req, HttpStatus.BAD_REQUEST, "Validation failed", details);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> badJson(HttpMessageNotReadableException ex, HttpServletRequest req) {
        return build(req, HttpStatus.BAD_REQUEST, "Malformed JSON request", null);
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> notFound(NotFoundException ex, HttpServletRequest req) {
        return build(req, HttpStatus.NOT_FOUND, ex.getMessage(), null);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> conflict(DataIntegrityViolationException ex, HttpServletRequest req) {
        return build(req, HttpStatus.CONFLICT, "Conflicting resource state", null);
    }

    @ExceptionHandler(ProducerUnavailableException.class)
    public ResponseEntity<ApiError> producerDown(ProducerUnavailableException ex, HttpServletRequest req) {
        return build(req, HttpStatus.SERVICE_UNAVAILABLE, "Producer Unavailable", null);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> fallback(Exception ex, HttpServletRequest req) {
        return build(req, HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected error", null);
    }

    private ResponseEntity<ApiError> build(HttpServletRequest req, HttpStatus status, String msg, List<FieldErr> details) {
        String traceId = MDC.get("traceId");
        if (traceId == null || traceId.isBlank()) {
            traceId = MDC.get("correlationId");
        }
        ApiError body = new ApiError(
                Instant.now(), traceId, status.value(), status.getReasonPhrase(), msg, details, req.getRequestURI());
        return ResponseEntity.status(status).body(body);
    }
}
