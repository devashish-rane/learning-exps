package com.deva.core_spring_service.model;

public record UserAggregateResponse(
        String id,
        String name,
        String email,
        boolean loggedIn,
        String correlationId
) {}
