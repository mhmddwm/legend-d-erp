from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.location import WarehouseLocation
from app.schemas.warehouse_location import (
    WarehouseLocationCreate,
    WarehouseLocationUpdate,
    WarehouseLocationOut
)


router = APIRouter(
    prefix="/api/warehouse-locations",
    tags=["Warehouse Locations"]
)


# =========================
# GET ALL LOCATIONS
# =========================

@router.get("", response_model=list[WarehouseLocationOut])
def get_locations(
    db: Session = Depends(get_db)
):
    return db.query(WarehouseLocation).all()



# =========================
# CREATE LOCATION
# =========================

@router.post(
    "",
    response_model=WarehouseLocationOut,
    status_code=201
)
def create_location(
    payload: WarehouseLocationCreate,
    db: Session = Depends(get_db)
):

    location = WarehouseLocation(
        warehouse_id=payload.warehouse_id,
        name=payload.name,
        rack=payload.rack,
        bin=payload.bin
    )

    db.add(location)
    db.commit()
    db.refresh(location)

    return location



# =========================
# UPDATE LOCATION
# =========================

@router.put(
    "/{location_id}",
    response_model=WarehouseLocationOut
)
def update_location(
    location_id: int,
    payload: WarehouseLocationUpdate,
    db: Session = Depends(get_db)
):

    location = (
        db.query(WarehouseLocation)
        .filter(WarehouseLocation.id == location_id)
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=404,
            detail="Location not found"
        )

    data = payload.model_dump(exclude_unset=True)

    for key, value in data.items():
        setattr(location, key, value)

    db.commit()
    db.refresh(location)

    return location



# =========================
# DELETE LOCATION
# =========================

@router.delete("/{location_id}")
def delete_location(
    location_id: int,
    db: Session = Depends(get_db)
):

    location = (
        db.query(WarehouseLocation)
        .filter(WarehouseLocation.id == location_id)
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=404,
            detail="Location not found"
        )

    db.delete(location)
    db.commit()

    return {
        "message": "Location deleted"
    }