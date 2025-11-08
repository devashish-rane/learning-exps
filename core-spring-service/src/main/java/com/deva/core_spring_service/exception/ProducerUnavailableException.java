package com.deva.core_spring_service.exception;

public class ProducerUnavailableException extends RuntimeException {
    public ProducerUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
