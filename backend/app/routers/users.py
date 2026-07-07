# CREATE USER
@router.post("/users")
def create_user(
    full_name: str,
    email: str,
    password_hash: str,
    db: Session = Depends(get_db)
):
    user = User(
        full_name=full_name,
        email=email,
        password_hash=password_hash
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user
