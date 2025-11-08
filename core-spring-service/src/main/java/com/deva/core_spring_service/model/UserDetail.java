package com.deva.core_spring_service.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

@Entity
@Table(name = "user_detail")
public class UserDetail {

    @Id
    @GeneratedValue
    @UuidGenerator
    private UUID id;

    @NotBlank(message = "Name cannot be empty")
    @Size(min = 2, max = 9, message = "Name must be 2–9 characters long")
    private String name;

    @NotBlank(message = "Email cannot be empty")
    @Email
    private String email;

//    no arg constructore is needed for jackson to read payloads
    public UserDetail(){}

    public UserDetail(String name, String email){
        this.name = name;
        this.email = email;
    }

    public String getName() {
        return name;
    }
    public void setName(String name) {
        this.name =  name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public UUID getId(){
        return this.id;
    }
}
