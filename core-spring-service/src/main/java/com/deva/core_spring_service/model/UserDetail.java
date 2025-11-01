package com.deva.core_spring_service.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

@Entity
@Table(name = "user_detail")
public class UserDetail {

    @Id
    @GeneratedValue
    UUID id = UUID.randomUUID();

    @NotBlank(message = "Name cannot be empty")
    @Size(min = 2, max = 9, message = "Name must be 2–9 characters long")
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

    public UUID getId(){
        return this.id;
    }
}
