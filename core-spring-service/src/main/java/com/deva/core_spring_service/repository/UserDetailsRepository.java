package com.deva.core_spring_service.repository;

import com.deva.core_spring_service.model.UserDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.UUID;

@Repository
public interface UserDetailsRepository extends JpaRepository<UserDetail, UUID> {

}
