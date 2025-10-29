package com.deva.core_spring_service.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;

import java.util.UUID;

@Entity
public class UserDetail {

    @Id
    @GeneratedValue
    UUID id = UUID.randomUUID();

    String name;

//    no arg constructore is needed for jackson to read payloads
    public UserDetail(){}

    public UserDetail(String name){
        this.name = name;
    }

    public String getName() {
        return name;
    }
    public void setName(String name) {
        this.name =  name;
    }
}
