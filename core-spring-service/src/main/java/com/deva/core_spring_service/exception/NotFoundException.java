package com.deva.core_spring_service.exception;

public class NotFoundException extends RuntimeException{

    public NotFoundException(String msg){
        super(msg);
    }

    public NotFoundException(String msg, Throwable cause){
        super(msg, cause);
    }
}
