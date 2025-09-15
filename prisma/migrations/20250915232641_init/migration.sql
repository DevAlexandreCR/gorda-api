-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable
CREATE TABLE "public"."branches" (
    "id" VARCHAR(50) NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "calling_code" VARCHAR(10) NOT NULL,
    "currency_code" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cities" (
    "id" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "center" geometry(Point,4326) NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "polygon" geometry(Polygon,4326),
    "branch_id" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."places" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point,4326) NOT NULL,
    "city_id" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cities_polygon_idx" ON "public"."cities" USING GIST ("polygon");

-- CreateIndex
CREATE INDEX "cities_center_idx" ON "public"."cities" USING GIST ("center");

-- CreateIndex
CREATE INDEX "places_location_idx" ON "public"."places" USING GIST ("location");

-- AddForeignKey
ALTER TABLE "public"."cities" ADD CONSTRAINT "cities_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."places" ADD CONSTRAINT "places_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
