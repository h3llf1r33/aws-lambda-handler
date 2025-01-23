export interface IUser {
    id: string;
    name: string;
}

export const mockUsers = (quantity: number): IUser[] => {
    return Array.from(Array(quantity).keys()).map((_, index): IUser => {
        const id = index + 1;
        return {
            id: String(id),
            name: `John Doe ${id}`
        }
    })
}

export const mockUser: IUser = {
    id: "1",
    name: "John Doe"
}