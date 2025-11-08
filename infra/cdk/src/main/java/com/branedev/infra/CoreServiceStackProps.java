package com.branedev.infra;

public class CoreServiceStackProps {
    private final String imageUri;
    private final Number desiredCount;

    private CoreServiceStackProps(Builder builder) {
        this.imageUri = builder.imageUri;
        this.desiredCount = builder.desiredCount;
    }

    public String getImageUri() {
        return imageUri;
    }

    public Number getDesiredCount() {
        return desiredCount;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String imageUri;
        private Number desiredCount;

        private Builder() {}

        public Builder imageUri(String imageUri) {
            this.imageUri = imageUri;
            return this;
        }

        public Builder desiredCount(Number desiredCount) {
            this.desiredCount = desiredCount;
            return this;
        }

        public CoreServiceStackProps build() {
            return new CoreServiceStackProps(this);
        }
    }
}
